import { redisClient } from '../config/redis';

// Redis GEO set of delivery partners currently ONLINE (available for new
// assignment) per location — key pattern from spec section 68:
// `location:<locationId>:active-partners`. BUSY/ON_DELIVERY/OFFLINE partners
// are removed so the set always reflects genuinely assignable partners.
function activePartnersKey(locationId: string): string {
  return `location:${locationId}:active-partners`;
}

export async function markPartnerActive(locationId: string, partnerId: string, longitude: number, latitude: number) {
  await redisClient.geoadd(activePartnersKey(locationId), longitude, latitude, partnerId);
}

export async function markPartnerInactive(locationId: string, partnerId: string) {
  await redisClient.zrem(activePartnersKey(locationId), partnerId);
}

export interface NearbyPartner {
  partnerId: string;
  distanceKm: number;
}

export async function findNearbyActivePartners(
  locationId: string,
  longitude: number,
  latitude: number,
  radiusKm: number,
): Promise<NearbyPartner[]> {
  const results = (await redisClient.geosearch(
    activePartnersKey(locationId),
    'FROMLONLAT',
    longitude,
    latitude,
    'BYRADIUS',
    radiusKm,
    'km',
    'ASC',
    'WITHCOORD',
    'WITHDIST',
  )) as unknown as [string, string, [string, string]][];

  return results.map(([partnerId, distance]) => ({ partnerId, distanceKm: parseFloat(distance) }));
}
