import { Offer } from '../models/Offer';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { GENERIC_STATUS, PROMOTION_OWNER_TYPES } from '../constants/enums';
import {
  arrayScopeOr,
  assertCanManagePromotion,
  isPromotionOwnerActor,
  lockCreateToOwner,
  lockUpdateToOwner,
  ownedByFilter,
  resolvePromotionTarget,
} from '../utils/promotionOwnership';

export interface OfferListQuery {
  status?: string;
  ownerType?: string;
  vendorId?: string;
  storeId?: string;
}

export function offerListFilter(user: JwtPayload, query: OfferListQuery): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (isPromotionOwnerActor(user)) return { ...filter, ...ownedByFilter(user) };

  if (query.ownerType) filter.ownerType = query.ownerType;
  if (query.vendorId) filter.$or = [{ vendorIds: query.vendorId }, { ownerType: PROMOTION_OWNER_TYPES.VENDOR, ownerId: query.vendorId }];
  if (query.storeId) filter.$or = [{ storeIds: query.storeId }, { ownerType: PROMOTION_OWNER_TYPES.STORE, ownerId: query.storeId }];
  return filter;
}

export async function listOffers(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total] = await Promise.all([
    Offer.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    Offer.countDocuments(filter),
  ]);
  return { items, total };
}

// ADMIN creates PLATFORM offers with any scoping; a VENDOR/STORE creates
// one locked to itself (see promotionOwnership.ts).
export async function createOffer(data: Record<string, unknown>, user: JwtPayload) {
  return Offer.create(lockCreateToOwner(user, data, 'OFFER'));
}

async function findOfferOrThrow(id: string) {
  const offer = await Offer.findById(id);
  if (!offer) throw ApiError.notFound('Offer not found', 'OFFER_NOT_FOUND');
  return offer;
}

export async function getOfferById(id: string, user: JwtPayload) {
  const offer = await findOfferOrThrow(id);
  if (isPromotionOwnerActor(user) && offer.ownerType !== PROMOTION_OWNER_TYPES.PLATFORM) {
    assertCanManagePromotion(user, offer);
  }
  return offer;
}

export async function updateOffer(id: string, data: Record<string, unknown>, user: JwtPayload) {
  const offer = await findOfferOrThrow(id);
  assertCanManagePromotion(user, offer);
  Object.assign(offer, lockUpdateToOwner(user, data));
  if (offer.startDate >= offer.endDate) {
    throw ApiError.badRequest('startDate must be before endDate', 'INVALID_DATE_RANGE');
  }
  await offer.save();
  return offer;
}

export async function deleteOffer(id: string, user: JwtPayload) {
  const offer = await findOfferOrThrow(id);
  assertCanManagePromotion(user, offer);
  await offer.deleteOne();
}

export async function updateOfferStatus(id: string, status: string, user: JwtPayload) {
  return updateOffer(id, { status }, user);
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
  // Viewing one restaurant/store: an offer scoped to vendor/store TYPES
  // shows only if this vendor/store is one of those types.
  if (filter.vendorId || filter.storeId) {
    const target = await resolvePromotionTarget(filter);
    clauses.push({ $or: arrayScopeOr('vendorTypeIds', target.vendorTypeIds) });
    clauses.push({ $or: arrayScopeOr('storeTypeIds', target.storeTypeIds) });
  }

  return Offer.find({ $and: clauses }).sort({ createdAt: -1 });
}
