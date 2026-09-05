import { DeliveryZone } from '../models/DeliveryZone';
import { Location } from '../models/Location';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { assertLocationAccess } from '../middleware/rbac.middleware';

export async function assertLocationExists(locationId: string): Promise<void> {
  const exists = await Location.exists({ _id: locationId });
  if (!exists) throw ApiError.notFound('Location not found', 'LOCATION_NOT_FOUND');
}

export async function listDeliveryZones(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total] = await Promise.all([
    DeliveryZone.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    DeliveryZone.countDocuments(filter),
  ]);
  return { items, total };
}

export async function createDeliveryZone(data: Record<string, unknown>) {
  await assertLocationExists(data.locationId as string);
  return DeliveryZone.create(data);
}

export async function getDeliveryZoneById(id: string, user: JwtPayload) {
  const zone = await DeliveryZone.findById(id);
  if (!zone) throw ApiError.notFound('Delivery zone not found', 'DELIVERY_ZONE_NOT_FOUND');
  assertLocationAccess(user, zone.locationId.toString());
  return zone;
}

export async function updateDeliveryZone(id: string, data: Record<string, unknown>, user: JwtPayload) {
  const existing = await DeliveryZone.findById(id);
  if (!existing) throw ApiError.notFound('Delivery zone not found', 'DELIVERY_ZONE_NOT_FOUND');
  assertLocationAccess(user, existing.locationId.toString());

  Object.assign(existing, data);
  await existing.save();
  return existing;
}

export async function deleteDeliveryZone(id: string, user: JwtPayload) {
  const existing = await DeliveryZone.findById(id);
  if (!existing) throw ApiError.notFound('Delivery zone not found', 'DELIVERY_ZONE_NOT_FOUND');
  assertLocationAccess(user, existing.locationId.toString());
  await existing.deleteOne();
}

export async function updateDeliveryZoneStatus(id: string, status: string, user: JwtPayload) {
  return updateDeliveryZone(id, { status }, user);
}
