import { Location } from '../models/Location';
import { DeliveryZone } from '../models/DeliveryZone';
import { Vendor } from '../models/Vendor';
import { Store } from '../models/Store';
import { haversineDistanceKm } from '../utils/geo';
import { GENERIC_STATUS, VENDOR_STATUS, STORE_STATUS } from '../constants/enums';
import { BUSINESS_TYPES, BusinessType } from '../constants/orderStatus';

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

async function findMatchingZone(locationId: string, latitude: number, longitude: number) {
  const geoMatch = await DeliveryZone.findOne({
    locationId,
    status: GENERIC_STATUS.ACTIVE,
    polygon: {
      $geoIntersects: { $geometry: { type: 'Point', coordinates: [longitude, latitude] } },
    },
  });
  if (geoMatch) return geoMatch;

  const radiusZones = await DeliveryZone.find({
    locationId,
    status: GENERIC_STATUS.ACTIVE,
    centerLatitude: { $exists: true },
    centerLongitude: { $exists: true },
    radius: { $exists: true },
  });

  let nearest: { zone: (typeof radiusZones)[number]; distanceKm: number } | null = null;
  for (const zone of radiusZones) {
    const distanceKm = haversineDistanceKm(latitude, longitude, zone.centerLatitude!, zone.centerLongitude!);
    if (distanceKm <= zone.radius! && (!nearest || distanceKm < nearest.distanceKm)) {
      nearest = { zone, distanceKm };
    }
  }
  return nearest?.zone ?? null;
}

async function hasActiveBusinessPresence(locationId: string, businessType: BusinessType): Promise<boolean> {
  if (businessType === BUSINESS_TYPES.FOOD) {
    return (await Vendor.exists({ locationId, status: VENDOR_STATUS.ACTIVE })) !== null;
  }
  return (await Store.exists({ locationId, status: STORE_STATUS.ACTIVE })) !== null;
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

  const hasPresence = await hasActiveBusinessPresence(location.id, businessType);
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
