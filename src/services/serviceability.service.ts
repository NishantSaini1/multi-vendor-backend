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
}

async function findServingLocation(latitude: number, longitude: number) {
  const activeLocations = await Location.find({ status: GENERIC_STATUS.ACTIVE });

  let nearest: { location: (typeof activeLocations)[number]; distanceKm: number } | null = null;
  for (const location of activeLocations) {
    const distanceKm = haversineDistanceKm(latitude, longitude, location.latitude, location.longitude);
    if (distanceKm <= location.serviceRadius && (!nearest || distanceKm < nearest.distanceKm)) {
      nearest = { location, distanceKm };
    }
  }
  return nearest?.location ?? null;
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
): Promise<ServiceabilityResult> {
  const location = await findServingLocation(latitude, longitude);
  if (!location) {
    return { serviceable: false, location: null, deliveryZone: null, deliveryFee: 0, estimatedDeliveryTime: null, reason: 'OUT_OF_SERVICE_AREA' };
  }

  const zone = await findMatchingZone(location.id, latitude, longitude);
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

  return {
    serviceable: true,
    location,
    deliveryZone: zone,
    deliveryFee: zone.deliveryFee,
    estimatedDeliveryTime: zone.estimatedDeliveryTime,
  };
}
