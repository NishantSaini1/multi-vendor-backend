import { Types } from 'mongoose';
import { ApiError } from './ApiError';
import { JwtPayload } from './jwt';
import { Vendor } from '../models/Vendor';
import { Store } from '../models/Store';
import { PROMOTION_OWNER_TYPES } from '../constants/enums';
import { BUSINESS_TYPES } from '../constants/orderStatus';

// Shared by coupon.service.ts and offer.service.ts. Coupons and Offers can be
// run by the platform (an ADMIN) or by a single restaurant (VENDOR) / store
// (STORE) for itself. An owner-run one is always locked to that owner: its
// scoping fields are forced server-side and can never be widened by the
// vendor/store, so a restaurant can't create a coupon that discounts some
// other restaurant's orders (vendors fund their own discounts — settlement
// is computed on subtotal - discount, see settlement.service.ts).

// Everything that decides WHERE a promotion applies — admin-only to set.
const SCOPE_FIELDS = [
  'locationIds',
  'businessTypes',
  'businessType',
  'vendorIds',
  'storeIds',
  'vendorTypeIds',
  'storeTypeIds',
  'ownerType',
  'ownerId',
] as const;

interface Owned {
  ownerType?: string;
  ownerId?: Types.ObjectId;
}

export function isPromotionOwnerActor(user: JwtPayload): boolean {
  return user.userType === 'VENDOR' || user.userType === 'STORE';
}

function stripScopeFields(data: Record<string, unknown>, user: JwtPayload): Record<string, unknown> {
  const copy = { ...data };
  for (const field of SCOPE_FIELDS) delete copy[field];
  // Food item scoping only means anything on a FOOD order.
  if (user.userType === 'STORE') delete copy.foodItemIds;
  return copy;
}

// Create payload -> what actually gets persisted. `kind` picks the
// businessType field shape (Coupon has businessTypes[], Offer a single
// businessType).
export function lockCreateToOwner(user: JwtPayload, data: Record<string, unknown>, kind: 'COUPON' | 'OFFER'): Record<string, unknown> {
  if (!isPromotionOwnerActor(user)) {
    return { ...data, ownerType: PROMOTION_OWNER_TYPES.PLATFORM, ownerId: undefined };
  }

  const isVendor = user.userType === 'VENDOR';
  const businessType = isVendor ? BUSINESS_TYPES.FOOD : BUSINESS_TYPES.INSTAMART;
  return {
    ...stripScopeFields(data, user),
    ownerType: isVendor ? PROMOTION_OWNER_TYPES.VENDOR : PROMOTION_OWNER_TYPES.STORE,
    ownerId: user.userId,
    vendorIds: isVendor ? [user.userId] : [],
    storeIds: isVendor ? [] : [user.userId],
    vendorTypeIds: [],
    storeTypeIds: [],
    locationIds: [],
    ...(kind === 'COUPON' ? { businessTypes: [businessType] } : { businessType }),
  };
}

// Update payload -> the subset the actor may change.
export function lockUpdateToOwner(user: JwtPayload, data: Record<string, unknown>): Record<string, unknown> {
  return isPromotionOwnerActor(user) ? stripScopeFields(data, user) : data;
}

export function isOwnedBy(user: JwtPayload, doc: Owned): boolean {
  return doc.ownerType === user.userType && doc.ownerId?.toString() === user.userId;
}

// Admins manage everything (including deactivating a vendor's own coupon);
// a vendor/store manages only what it created.
export function assertCanManagePromotion(user: JwtPayload, doc: Owned): void {
  if (user.userType === 'ADMIN') return;
  if (!isOwnedBy(user, doc)) {
    throw ApiError.forbidden('You can only manage your own coupons and offers', 'PROMOTION_FORBIDDEN');
  }
}

export function ownedByFilter(user: JwtPayload): Record<string, unknown> {
  return { ownerType: user.userType, ownerId: new Types.ObjectId(user.userId) };
}

export interface PromotionTarget {
  locationId?: string;
  vendorTypeIds: string[];
  storeTypeIds: string[];
}

// The ordering vendor's/store's own type ids (and location), so a promotion
// scoped by vendorTypeIds/storeTypeIds can be matched against it.
export async function resolvePromotionTarget(ctx: { vendorId?: string; storeId?: string }): Promise<PromotionTarget> {
  if (ctx.vendorId) {
    const vendor = await Vendor.findById(ctx.vendorId).select('vendorTypeIds locationId');
    return {
      locationId: vendor?.locationId?.toString(),
      vendorTypeIds: (vendor?.vendorTypeIds ?? []).map((id) => id.toString()),
      storeTypeIds: [],
    };
  }
  if (ctx.storeId) {
    const store = await Store.findById(ctx.storeId).select('storeTypeIds locationId');
    return {
      locationId: store?.locationId?.toString(),
      vendorTypeIds: [],
      storeTypeIds: (store?.storeTypeIds ?? []).map((id) => id.toString()),
    };
  }
  return { vendorTypeIds: [], storeTypeIds: [] };
}

// Mongo `$or` for one array scoping field: unscoped (empty), or overlapping
// the given ids. With no ids, only unscoped promotions match.
export function arrayScopeOr(field: string, ids: string[]): Record<string, unknown>[] {
  return [{ [field]: { $size: 0 } }, ...(ids.length ? [{ [field]: { $in: ids.map((id) => new Types.ObjectId(id)) } }] : [])];
}
