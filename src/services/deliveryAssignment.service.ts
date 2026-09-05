import { DeliveryPartner } from '../models/DeliveryPartner';
import { Location } from '../models/Location';
import { ApiError } from '../utils/ApiError';
import { JwtPayload } from '../utils/jwt';
import { assertLocationAccess } from '../middleware/rbac.middleware';
import { findNearbyActivePartners } from './deliveryPartnerLocation.service';
import { DELIVERY_PARTNER_STATUS, DELIVERY_PARTNER_AVAILABILITY } from '../constants/deliveryStatus';

const DEFAULT_SEARCH_RADIUS_KM = 5;

export interface AvailablePartner {
  id: string;
  name: string;
  phone: string;
  rating: number;
  distanceKm: number;
}

// Discovers ONLINE, ACTIVE delivery partners near a pickup point within a
// location, ranked by distance. This is the read-only "who could take this"
// query from spec section 33 — actually assigning a partner to an order
// (POST /delivery/assign, /reassign) is added once the Order module exists,
// since a Delivery record requires a real orderId to attach to.
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

  const nearby = await findNearbyActivePartners(locationId, longitude, latitude, radiusKm);
  if (nearby.length === 0) return [];

  const partners = await DeliveryPartner.find({
    _id: { $in: nearby.map((n) => n.partnerId) },
    status: DELIVERY_PARTNER_STATUS.ACTIVE,
    availability: DELIVERY_PARTNER_AVAILABILITY.ONLINE,
  });
  const partnerById = new Map(partners.map((p) => [p.id, p]));

  return nearby
    .filter((n) => partnerById.has(n.partnerId))
    .map((n) => {
      const partner = partnerById.get(n.partnerId)!;
      return {
        id: partner.id,
        name: partner.name,
        phone: partner.phone,
        rating: partner.rating,
        distanceKm: n.distanceKm,
      };
    });
}
