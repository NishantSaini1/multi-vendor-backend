import { nominatimClient } from '../config/nominatim';
import { ApiError } from '../utils/ApiError';
import { logger } from '../utils/logger';

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

// This endpoint sits behind our own auth + the app's general rate limiter
// rather than being exposed as an open, unauthenticated proxy to OSM (see
// config/nominatim.ts for the usage-policy note on the User-Agent header).
export async function geocodeSearch(query: string) {
  try {
    const { data } = await nominatimClient.get<NominatimResult[]>('/search', {
      params: { q: query, format: 'json', limit: 5 },
    });
    return data.map((r) => ({
      latitude: parseFloat(r.lat),
      longitude: parseFloat(r.lon),
      displayName: r.display_name,
    }));
  } catch (err) {
    logger.error({ err, query }, 'Nominatim forward geocoding failed');
    throw ApiError.internal('Geocoding service is currently unavailable', 'GEOCODING_UNAVAILABLE');
  }
}

export async function geocodeReverse(latitude: number, longitude: number) {
  try {
    const { data } = await nominatimClient.get<NominatimResult>('/reverse', {
      params: { lat: latitude, lon: longitude, format: 'json' },
    });
    if (!data || !data.display_name) {
      throw ApiError.notFound('No address found for these coordinates', 'ADDRESS_NOT_FOUND');
    }
    return { latitude: parseFloat(data.lat), longitude: parseFloat(data.lon), displayName: data.display_name };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    logger.error({ err, latitude, longitude }, 'Nominatim reverse geocoding failed');
    throw ApiError.internal('Geocoding service is currently unavailable', 'GEOCODING_UNAVAILABLE');
  }
}
