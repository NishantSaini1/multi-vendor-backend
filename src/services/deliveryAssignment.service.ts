import { Location } from '../models/Location';
import { ApiError } from '../utils/ApiError';
import { JwtPayload } from '../utils/jwt';
import { assertLocationAccess } from '../middleware/rbac.middleware';
import { findOnlinePartnersNear } from './delivery.service';

const DEFAULT_SEARCH_RADIUS_KM = 5;

export interface AvailablePartner {
  id: string;
  name: string;
  phone: string;
  rating: number;
  distanceKm: number;
}

// Discovers ONLINE, ACTIVE delivery partners near a pickup point within a
// location, ranked by distance — the read-only "who could take this" query
// from spec section 33 behind the admin's manual assign/reassign picker.
// Uses the same Mongo-backed lookup as auto-assignment (see
// delivery.service.ts's findOnlinePartnersNear), so the list is correct even
// right after a restart without Redis.
export async function findAvailablePartners(
  locationId: string,
  latitude: number,
  longitude: number,
  radiusKm: number = DEFAULT_SEARCH_RADIUS_KM,
  user: JwtPayload,
): Promise<AvailablePartner[]> {
  const locationExists = await Location.exists({ _id: locationId });
  if (!locationExists) throw ApiError.notFound('Location not found', 'LOCATION_NOT_FOUND');
  assertLocationAccess(user, locationId);

  const nearby = await findOnlinePartnersNear(locationId, latitude, longitude, radiusKm);
  return nearby.map(({ partner, distanceKm }) => ({
    id: partner.id,
    name: partner.name,
    phone: partner.phone,
    rating: partner.rating,
    distanceKm,
  }));
}
