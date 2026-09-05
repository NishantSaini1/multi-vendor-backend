import { Offer } from '../models/Offer';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { GENERIC_STATUS } from '../constants/enums';

export async function listOffers(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total] = await Promise.all([
    Offer.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    Offer.countDocuments(filter),
  ]);
  return { items, total };
}

export async function createOffer(data: Record<string, unknown>) {
  return Offer.create(data);
}

async function findOfferOrThrow(id: string) {
  const offer = await Offer.findById(id);
  if (!offer) throw ApiError.notFound('Offer not found', 'OFFER_NOT_FOUND');
  return offer;
}

export async function getOfferById(id: string) {
  return findOfferOrThrow(id);
}

export async function updateOffer(id: string, data: Record<string, unknown>) {
  const offer = await findOfferOrThrow(id);
  Object.assign(offer, data);
  await offer.save();
  return offer;
}

export async function deleteOffer(id: string) {
  const offer = await findOfferOrThrow(id);
  await offer.deleteOne();
}

export async function updateOfferStatus(id: string, status: string) {
  return updateOffer(id, { status });
}

// Public "what's currently running" query — display-only. Offers are
// informational/marketing content (e.g. "20% off this week"), not an
// auto-applying discount mechanism: unlike Coupon, nothing here computes or
// deducts from an order's total. If an offer needs to actually discount a
// checkout, model it as a Coupon (which order.service already applies) —
// keeping exactly one path that touches order pricing avoids two discount
// systems disagreeing with each other.
export async function listActiveOffers(filter: { locationId?: string; businessType?: string; vendorId?: string; storeId?: string }) {
  const now = new Date();
  const clauses: Record<string, unknown>[] = [
    { status: GENERIC_STATUS.ACTIVE },
    { startDate: { $lte: now } },
    { endDate: { $gte: now } },
  ];
  // Each scoping array (locationIds/vendorIds/storeIds) means "unrestricted"
  // when empty — an offer targeting no specific location/vendor/store
  // applies everywhere along that dimension.
  if (filter.locationId) clauses.push({ $or: [{ locationIds: { $size: 0 } }, { locationIds: filter.locationId }] });
  if (filter.businessType) clauses.push({ businessType: { $in: [null, filter.businessType] } });
  if (filter.vendorId) clauses.push({ $or: [{ vendorIds: { $size: 0 } }, { vendorIds: filter.vendorId }] });
  if (filter.storeId) clauses.push({ $or: [{ storeIds: { $size: 0 } }, { storeIds: filter.storeId }] });

  return Offer.find({ $and: clauses }).sort({ createdAt: -1 });
}
