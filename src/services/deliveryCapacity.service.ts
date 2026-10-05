import { Types } from 'mongoose';
import { DeliveryPartner } from '../models/DeliveryPartner';
import { DeliveryCapacitySetting, DELIVERY_CAPACITY_MODES } from '../models/DeliveryCapacitySetting';
import { DELIVERY_PARTNER_STATUS, DELIVERY_PARTNER_AVAILABILITY } from '../constants/deliveryStatus';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { haversineDistanceKm } from '../utils/geo';
import { JwtPayload } from '../utils/jwt';
import { assertLocationAccess } from '../middleware/rbac.middleware';

// "Can we deliver right now?" — customers may add to cart and place orders only
// while there is a delivery partner free to take the order. A partner is free
// when ACTIVE and ONLINE (a partner on a delivery is BUSY, one signed off is
// OFFLINE) with a known position within the radius of the seller — the same
// rule auto-assignment uses to pick a rider (see delivery.service's
// findOnlinePartnersNear), so "available" here means an order placed now would
// actually find someone. Everything is computed live from partner state, and an
// admin can tune or override it per location (DeliveryCapacitySetting).

export const DEFAULT_HIGH_DEMAND_MESSAGE =
  "We're experiencing very high demand and all our delivery partners are busy right now. Please try again in a few minutes.";

// How soon a client should look again (the apps poll on this).
export const CAPACITY_RETRY_AFTER_SECONDS = 30;

export interface CapacitySettings {
  mode: string;
  minAvailablePartners: number;
  radiusKm: number;
  message?: string;
}

export interface DeliveryCapacity {
  available: boolean;
  status: 'AVAILABLE' | 'HIGH_DEMAND';
  // Why ordering is paused; absent while available.
  reason?: 'NO_PARTNERS_AVAILABLE' | 'PAUSED_BY_ADMIN';
  message?: string;
  retryAfterSeconds: number;
}

interface Point {
  latitude: number;
  longitude: number;
}

export async function resolveCapacitySettings(locationId: string): Promise<CapacitySettings> {
  const doc =
    (await DeliveryCapacitySetting.findOne({ locationId })) ?? (await DeliveryCapacitySetting.findOne({ locationId: null }));
  return {
    mode: doc?.mode ?? DELIVERY_CAPACITY_MODES.AUTO,
    minAvailablePartners: doc?.minAvailablePartners ?? 1,
    radiusKm: doc?.radiusKm ?? env.AUTO_ASSIGN_RADIUS_KM,
    message: doc?.message || undefined,
  };
}

// Pure decision, kept apart from the lookups so it can be tested directly.
export function decideCapacity(settings: CapacitySettings, availablePartners: number): DeliveryCapacity {
  if (settings.mode === DELIVERY_CAPACITY_MODES.FORCE_OPEN) {
    return { available: true, status: 'AVAILABLE', retryAfterSeconds: CAPACITY_RETRY_AFTER_SECONDS };
  }
  if (settings.mode === DELIVERY_CAPACITY_MODES.FORCE_PAUSED) {
    return {
      available: false,
      status: 'HIGH_DEMAND',
      reason: 'PAUSED_BY_ADMIN',
      message: settings.message ?? DEFAULT_HIGH_DEMAND_MESSAGE,
      retryAfterSeconds: CAPACITY_RETRY_AFTER_SECONDS,
    };
  }
  if (availablePartners >= settings.minAvailablePartners) {
    return { available: true, status: 'AVAILABLE', retryAfterSeconds: CAPACITY_RETRY_AFTER_SECONDS };
  }
  return {
    available: false,
    status: 'HIGH_DEMAND',
    reason: 'NO_PARTNERS_AVAILABLE',
    message: settings.message ?? DEFAULT_HIGH_DEMAND_MESSAGE,
    retryAfterSeconds: CAPACITY_RETRY_AFTER_SECONDS,
  };
}

// Partners free to take an order at `pickup` (or anywhere in the location when
// no pickup point is given — a location-wide check).
async function countAvailablePartners(locationId: string, pickup: Point | undefined, radiusKm: number): Promise<number> {
  const partners = await DeliveryPartner.find({
    locationId,
    status: DELIVERY_PARTNER_STATUS.ACTIVE,
    availability: DELIVERY_PARTNER_AVAILABILITY.ONLINE,
    currentLatitude: { $ne: null },
    currentLongitude: { $ne: null },
  }).select('currentLatitude currentLongitude');
  if (!pickup) return partners.length;
  return partners.filter(
    (p) => haversineDistanceKm(pickup.latitude, pickup.longitude, p.currentLatitude!, p.currentLongitude!) <= radiusKm,
  ).length;
}

export async function getDeliveryCapacity(params: { locationId: string; pickup?: Point }): Promise<DeliveryCapacity> {
  const settings = await resolveCapacitySettings(params.locationId);
  // No need to look at partners when an admin has forced the answer.
  const free =
    settings.mode === DELIVERY_CAPACITY_MODES.AUTO
      ? await countAvailablePartners(params.locationId, params.pickup, settings.radiusKm)
      : 0;
  return decideCapacity(settings, free);
}

// 503 (not a validation error): nothing is wrong with the request — the
// platform can't take it right now. Clients key off the DELIVERY_UNAVAILABLE
// code to show the high-demand screen instead of a generic error.
export async function assertDeliveryCapacity(params: { locationId: string; pickup?: Point }): Promise<void> {
  const capacity = await getDeliveryCapacity(params);
  if (!capacity.available) {
    throw new ApiError(503, capacity.message ?? DEFAULT_HIGH_DEMAND_MESSAGE, 'DELIVERY_UNAVAILABLE', {
      reason: capacity.reason,
      retryAfterSeconds: capacity.retryAfterSeconds,
    });
  }
}

// --- Admin ----------------------------------------------------------------

// Live counts for the admin dashboard, so "why is ordering paused?" is visible.
export async function getCapacityStatus(locationId: string, user: JwtPayload) {
  assertLocationAccess(user, locationId);
  const [settings, counts] = await Promise.all([
    resolveCapacitySettings(locationId),
    DeliveryPartner.aggregate([
      { $match: { locationId: new Types.ObjectId(locationId), status: DELIVERY_PARTNER_STATUS.ACTIVE } },
      { $group: { _id: '$availability', count: { $sum: 1 } } },
    ]),
  ]);
  const byAvailability = Object.fromEntries(counts.map((c) => [c._id as string, c.count as number]));
  const online = byAvailability[DELIVERY_PARTNER_AVAILABILITY.ONLINE] ?? 0;
  const free = await countAvailablePartners(locationId, undefined, settings.radiusKm);
  return {
    settings,
    partners: {
      online,
      busy: byAvailability[DELIVERY_PARTNER_AVAILABILITY.BUSY] ?? 0,
      offline: byAvailability[DELIVERY_PARTNER_AVAILABILITY.OFFLINE] ?? 0,
      // ONLINE with a known position — the ones that can actually be offered an order.
      availableToAssign: free,
    },
    capacity: decideCapacity(settings, settings.mode === DELIVERY_CAPACITY_MODES.AUTO ? free : 0),
  };
}

export async function getCapacitySettings(locationId: string | null, user: JwtPayload) {
  if (locationId) assertLocationAccess(user, locationId);
  const doc = await DeliveryCapacitySetting.findOne({ locationId });
  return {
    locationId,
    mode: doc?.mode ?? DELIVERY_CAPACITY_MODES.AUTO,
    minAvailablePartners: doc?.minAvailablePartners ?? 1,
    radiusKm: doc?.radiusKm ?? null,
    message: doc?.message ?? null,
    // The value actually used when radiusKm is left blank.
    defaultRadiusKm: env.AUTO_ASSIGN_RADIUS_KM,
    isDefault: !doc,
  };
}

export async function updateCapacitySettings(
  locationId: string | null,
  input: { mode?: string; minAvailablePartners?: number; radiusKm?: number | null; message?: string | null },
  user: JwtPayload,
) {
  // The global setting changes every location, so it needs an unrestricted admin.
  if (locationId) assertLocationAccess(user, locationId);
  else if (user.locationIds.length > 0) {
    throw ApiError.forbidden('Only an admin with access to every location can change the global setting', 'GLOBAL_SETTING_FORBIDDEN');
  }

  // null / empty clears an optional field back to its default.
  const set: Record<string, unknown> = { updatedBy: user.userId };
  const unset: Record<string, 1> = {};
  if (input.mode !== undefined) set.mode = input.mode;
  if (input.minAvailablePartners !== undefined) set.minAvailablePartners = input.minAvailablePartners;
  if (input.radiusKm === null) unset.radiusKm = 1;
  else if (input.radiusKm !== undefined) set.radiusKm = input.radiusKm;
  if (input.message === null || input.message === '') unset.message = 1;
  else if (input.message !== undefined) set.message = input.message;

  await DeliveryCapacitySetting.findOneAndUpdate(
    { locationId },
    { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { upsert: true, new: true, runValidators: true },
  );
  return getCapacitySettings(locationId, user);
}
