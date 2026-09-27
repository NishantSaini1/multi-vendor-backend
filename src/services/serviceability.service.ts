import { Location } from '../models/Location';
import { Vendor } from '../models/Vendor';
import { Store } from '../models/Store';
import { haversineDistanceKm } from '../utils/geo';
import { GENERIC_STATUS, VENDOR_STATUS, STORE_STATUS } from '../constants/enums';
import { BUSINESS_TYPES, BusinessType } from '../constants/orderStatus';
import { findMatchingZone } from './deliveryZone.service';

export interface ServiceabilityResult {
  serviceable: boolean;
  location: unknown;
  deliveryZone: unknown;
  deliveryFee: number;
  estimatedDeliveryTime: number | null;
  reason?: string;
  // Only when a specific seller was checked (vendorId / storeId).
  sellerDistanceKm?: number;
  sellerServiceRadiusKm?: number;
}

export interface ServiceabilitySeller {
  vendorId?: string;
  storeId?: string;
}

// Resolves the Location + DeliveryZone serving a point.
//
// A point inside a Location's serviceRadius is tried first (nearest first).
// But zones are the real delivery boundary: an admin can draw a zone that
// reaches past its parent location's radius (or the location's centre can be
// mis-pinned — Budhana's sat ~16 km west of the town, so every address in
// the town's own "Bada Bazar" zone was rejected as OUT_OF_SERVICE_AREA before
// the zone was ever looked at). So when no radius-matched location has a
// zone for the point, any active location whose active zone covers it wins.
async function resolveLocationAndZone(latitude: number, longitude: number) {
  const activeLocations = await Location.find({ status: GENERIC_STATUS.ACTIVE });
  const byDistance = activeLocations
    .map((location) => ({
      location,
      distanceKm: haversineDistanceKm(latitude, longitude, location.latitude, location.longitude),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const inRadius = byDistance.filter((c) => c.distanceKm <= c.location.serviceRadius);
  for (const { location } of inRadius) {
    const zone = await findMatchingZone(location.id, latitude, longitude);
    if (zone) return { location, zone };
  }
  for (const { location, distanceKm } of byDistance) {
    if (distanceKm <= location.serviceRadius) continue; // already tried
    const zone = await findMatchingZone(location.id, latitude, longitude);
    if (zone) return { location, zone };
  }
  // No zone anywhere — still report the radius-matched location (if any) so
  // the caller can tell "no zone configured" apart from "no service at all".
  return { location: inRadius[0]?.location ?? null, zone: null };
}

// FOOD (Vendor) presence stays location-wide — only INSTAMART (Store) is
// scoped to the specific zone that was actually matched, per the
// Location -> Zone -> Store hierarchy: a store belongs to exactly one zone,
// so "serviceable" must mean a store exists in *that* zone, not merely
// somewhere else in the same location.
async function hasActiveBusinessPresence(
  locationId: string,
  businessType: BusinessType,
  zoneId: string,
): Promise<boolean> {
  if (businessType === BUSINESS_TYPES.FOOD) {
    return (await Vendor.exists({ locationId, status: VENDOR_STATUS.ACTIVE })) !== null;
  }
  return (await Store.exists({ deliveryZoneId: zoneId, status: STORE_STATUS.ACTIVE })) !== null;
}

export async function checkServiceability(
  latitude: number,
  longitude: number,
  businessType: BusinessType,
  seller: ServiceabilitySeller = {},
): Promise<ServiceabilityResult> {
  const { location, zone } = await resolveLocationAndZone(latitude, longitude);
  if (!location) {
    return { serviceable: false, location: null, deliveryZone: null, deliveryFee: 0, estimatedDeliveryTime: null, reason: 'OUT_OF_SERVICE_AREA' };
  }

  if (!zone) {
    return {
      serviceable: false,
      location,
      deliveryZone: null,
      deliveryFee: 0,
      estimatedDeliveryTime: null,
      reason: 'NO_DELIVERY_ZONE_CONFIGURED',
    };
  }

  const hasPresence = await hasActiveBusinessPresence(location.id, businessType, zone.id);
  if (!hasPresence) {
    return {
      serviceable: false,
      location,
      deliveryZone: zone,
      deliveryFee: zone.deliveryFee,
      estimatedDeliveryTime: zone.estimatedDeliveryTime,
      reason: businessType === BUSINESS_TYPES.FOOD ? 'NO_ACTIVE_VENDORS' : 'NO_ACTIVE_STORES',
    };
  }

  const base = {
    location,
    deliveryZone: zone,
    deliveryFee: zone.deliveryFee,
    estimatedDeliveryTime: zone.estimatedDeliveryTime,
  };

  // Seller-specific range: the area being served isn't enough — the chosen
  // restaurant must reach this address (its own serviceRadius), and the
  // chosen store must belong to the matched zone.
  if (businessType === BUSINESS_TYPES.FOOD && seller.vendorId) {
    const vendor = await Vendor.findById(seller.vendorId).select('status locationId latitude longitude serviceRadius');
    if (!vendor || vendor.status !== VENDOR_STATUS.ACTIVE) {
      return { serviceable: false, ...base, reason: 'SELLER_NOT_ACTIVE' };
    }
    const sellerDistanceKm = Math.round(haversineDistanceKm(latitude, longitude, vendor.latitude, vendor.longitude) * 10) / 10;
    const sellerServiceRadiusKm = vendor.serviceRadius ?? 5;
    if (vendor.locationId?.toString() !== location.id || sellerDistanceKm > sellerServiceRadiusKm) {
      return { serviceable: false, ...base, reason: 'OUT_OF_SELLER_RANGE', sellerDistanceKm, sellerServiceRadiusKm };
    }
    return { serviceable: true, ...base, sellerDistanceKm, sellerServiceRadiusKm };
  }
  if (businessType === BUSINESS_TYPES.INSTAMART && seller.storeId) {
    const store = await Store.findById(seller.storeId).select('status deliveryZoneId latitude longitude');
    if (!store || store.status !== STORE_STATUS.ACTIVE) {
      return { serviceable: false, ...base, reason: 'SELLER_NOT_ACTIVE' };
    }
    const sellerDistanceKm = Math.round(haversineDistanceKm(latitude, longitude, store.latitude, store.longitude) * 10) / 10;
    if (store.deliveryZoneId?.toString() !== zone.id) {
      return { serviceable: false, ...base, reason: 'OUT_OF_SELLER_RANGE', sellerDistanceKm };
    }
    return { serviceable: true, ...base, sellerDistanceKm };
  }

  return { serviceable: true, ...base };
}
