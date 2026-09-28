import type { Model } from 'mongoose';
import { PaginationParams } from './pagination';

export const DEFAULT_SELLER_SERVICE_RADIUS_KM = 5;
const DEG = Math.PI / 180;

// Haversine distance (km) from (lat, lng) to the document's own
// latitude/longitude, as an aggregation expression — the same formula as
// utils/geo.ts's haversineDistanceKm, which order.service.ts uses to reject
// out-of-range orders, so lists and checkout always agree.
export function distanceKmExpr(lat: number, lng: number) {
  const docLatRad = { $multiply: ['$latitude', DEG] };
  const halfDLat = { $divide: [{ $multiply: [{ $subtract: ['$latitude', lat] }, DEG] }, 2] };
  const halfDLng = { $divide: [{ $multiply: [{ $subtract: ['$longitude', lng] }, DEG] }, 2] };
  const a = {
    $add: [
      { $pow: [{ $sin: halfDLat }, 2] },
      { $multiply: [Math.cos(lat * DEG), { $cos: docLatRad }, { $pow: [{ $sin: halfDLng }, 2] }] },
    ],
  };
  return { $multiply: [2 * 6371, { $asin: { $sqrt: { $min: [1, a] } } }] };
}

// Sellers (Vendor / Store — both have latitude, longitude, serviceRadius)
// matching `filter` whose own serviceRadius reaches (lat, lng), nearest first,
// paginated. Returns hydrated documents so callers serialize them exactly as
// they would a normal find().
export async function findSellersInRange<T>(
  model: Model<T>,
  filter: Record<string, unknown>,
  pagination: PaginationParams,
  lat: number,
  lng: number,
) {
  // aggregate() skips Mongoose casting — cast the filter (ObjectIds etc.) first.
  const match = model.find().cast(model, filter);
  const [result] = await model.aggregate([
    { $match: match },
    { $addFields: { _distanceKm: distanceKmExpr(lat, lng) } },
    {
      $match: {
        $expr: { $lte: ['$_distanceKm', { $ifNull: ['$serviceRadius', DEFAULT_SELLER_SERVICE_RADIUS_KM] }] },
      },
    },
    {
      $facet: {
        items: [
          { $sort: { _distanceKm: 1, _id: 1 } },
          { $skip: pagination.skip },
          { $limit: pagination.limit },
          { $project: { _distanceKm: 0, password: 0 } },
        ],
        total: [{ $count: 'n' }],
      },
    },
  ]);
  const docs: Record<string, unknown>[] = result?.items ?? [];
  return { items: docs.map((d) => model.hydrate(d)), total: (result?.total?.[0]?.n as number | undefined) ?? 0 };
}

// Parses ?lat=&lng= from a request query; undefined unless both are valid.
export function parseCoords(query: Record<string, unknown>): { lat: number; lng: number } | undefined {
  if (query.lat === undefined || query.lng === undefined) return undefined;
  const lat = Number(query.lat);
  const lng = Number(query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined;
  return { lat, lng };
}
