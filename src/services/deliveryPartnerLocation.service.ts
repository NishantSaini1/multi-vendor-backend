import { redisClient } from '../config/redis';
import { logger } from '../utils/logger';

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

// A flaky Redis can report 'ready' yet stall commands for tens of seconds
// before ioredis gives up. The memory set above is already updated, so the
// Redis mirror is best-effort: cap each call and never fail the request
// (callers like updateAvailability have already saved the partner).
const REDIS_GEO_TIMEOUT_MS = 2000;

async function bestEffortRedis<T>(op: string, run: () => Promise<T>): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Redis ${op} timed out after ${REDIS_GEO_TIMEOUT_MS}ms`)), REDIS_GEO_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    logger.warn({ err, op }, 'Redis partner geo operation failed; using in-memory set');
    return undefined;
  } finally {
    clearTimeout(timer);
  }
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
  if (redisReady()) await bestEffortRedis('geoadd', () => redisClient.geoadd(key, longitude, latitude, partnerId));
}

export async function markPartnerInactive(locationId: string, partnerId: string) {
  const key = activePartnersKey(locationId);
  memoryPartners.get(key)?.delete(partnerId);
  if (redisReady()) await bestEffortRedis('zrem', () => redisClient.zrem(key, partnerId));
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
  const fromMemory = () =>
    [...(memoryPartners.get(key) ?? new Map()).entries()]
      .map(([partnerId, pos]) => ({ partnerId, distanceKm: haversineKm(longitude, latitude, pos.longitude, pos.latitude) }))
      .filter((p) => p.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);

  if (!redisReady()) return fromMemory();

  const results = (await bestEffortRedis('geosearch', () =>
    redisClient.geosearch(key, 'FROMLONLAT', longitude, latitude, 'BYRADIUS', radiusKm, 'km', 'ASC', 'WITHCOORD', 'WITHDIST'),
  )) as unknown as [string, string, [string, string]][] | undefined;

  if (!results) return fromMemory();
  return results.map(([partnerId, distance]) => ({ partnerId, distanceKm: parseFloat(distance) }));
}
