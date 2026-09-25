import { redisClient } from '../config/redis';

// Redis GEO set of delivery partners currently ONLINE (available for new
// assignment) per location — key pattern from spec section 68:
// `location:<locationId>:active-partners`. BUSY/ON_DELIVERY/OFFLINE partners
// are removed so the set always reflects genuinely assignable partners.
function activePartnersKey(locationId: string): string {
  return `location:${locationId}:active-partners`;
}

// Same set kept in process memory, used whenever Redis isn't connected
// (e.g. Render without REDIS_URL). Writes go to both so switching between
// them doesn't lose partners that went online during an outage.
const memoryPartners = new Map<string, Map<string, { longitude: number; latitude: number }>>();

function redisReady(): boolean {
  return redisClient.status === 'ready';
}

function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

export async function markPartnerActive(locationId: string, partnerId: string, longitude: number, latitude: number) {
  const key = activePartnersKey(locationId);
  if (!memoryPartners.has(key)) memoryPartners.set(key, new Map());
  memoryPartners.get(key)!.set(partnerId, { longitude, latitude });
  if (redisReady()) await redisClient.geoadd(key, longitude, latitude, partnerId);
}

export async function markPartnerInactive(locationId: string, partnerId: string) {
  const key = activePartnersKey(locationId);
  memoryPartners.get(key)?.delete(partnerId);
  if (redisReady()) await redisClient.zrem(key, partnerId);
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
  const key = activePartnersKey(locationId);

  if (!redisReady()) {
    return [...(memoryPartners.get(key) ?? new Map()).entries()]
      .map(([partnerId, pos]) => ({ partnerId, distanceKm: haversineKm(longitude, latitude, pos.longitude, pos.latitude) }))
      .filter((p) => p.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }

  const results = (await redisClient.geosearch(
    key,
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
