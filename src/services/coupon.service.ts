import { ClientSession } from 'mongoose';
import { Coupon, ICoupon } from '../models/Coupon';
import { Order } from '../models/Order';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { GENERIC_STATUS, DISCOUNT_TYPES } from '../constants/enums';

export function couponListFilter(): Record<string, unknown> {
  // Coupons aren't location-owned the way Vendor/Store are — MARKETING_ADMIN
  // (the only role with COUPON_VIEW/MANAGE besides SUPER_ADMIN) operates
  // platform-wide, so there's no location scoping to apply here.
  return {};
}

export async function listCoupons(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total] = await Promise.all([
    Coupon.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    Coupon.countDocuments(filter),
  ]);
  return { items, total };
}

// Customer-facing "browse applicable coupons" — mirrors the same
// eligibility rules applyCoupon enforces at order time (active window,
// location/businessType/vendor/store scoping, not yet exhausted), so a
// coupon shown here is actually usable, not just a code that exists. Unlike
// applyCoupon this can't check the per-user limit against a specific order's
// subtotal in advance, since there's no order yet — the customer still
// finds that out for real when POST /orders validates it.
export async function listActiveCouponsForCustomer(ctx: {
  locationId: string;
  businessType: string;
  vendorId?: string;
  storeId?: string;
}) {
  const now = new Date();
  const scopeOr = (field: 'locationIds' | 'vendorIds' | 'storeIds', value: string | undefined) => [
    { [field]: { $size: 0 } },
    ...(value ? [{ [field]: value }] : []),
  ];

  const coupons = await Coupon.find({
    status: GENERIC_STATUS.ACTIVE,
    startDate: { $lte: now },
    endDate: { $gte: now },
    $and: [
      { $or: [{ businessTypes: { $size: 0 } }, { businessTypes: ctx.businessType }] },
      { $or: scopeOr('locationIds', ctx.locationId) },
      { $or: scopeOr('vendorIds', ctx.vendorId) },
      { $or: scopeOr('storeIds', ctx.storeId) },
    ],
    $expr: { $or: [{ $eq: ['$usageLimit', null] }, { $lt: ['$usedCount', '$usageLimit'] }] },
  }).sort({ discountValue: -1 });

  return coupons;
}

export async function createCoupon(data: Record<string, unknown>) {
  const code = String(data.code).toUpperCase();
  const existing = await Coupon.findOne({ code });
  if (existing) throw ApiError.conflict('A coupon with this code already exists', 'COUPON_CODE_EXISTS');
  return Coupon.create({ ...data, code });
}

async function findCouponOrThrow(id: string) {
  const coupon = await Coupon.findById(id);
  if (!coupon) throw ApiError.notFound('Coupon not found', 'COUPON_NOT_FOUND');
  return coupon;
}

export async function getCouponById(id: string) {
  return findCouponOrThrow(id);
}

export async function updateCoupon(id: string, data: Record<string, unknown>) {
  const coupon = await findCouponOrThrow(id);
  Object.assign(coupon, data);
  await coupon.save();
  return coupon;
}

export async function deleteCoupon(id: string) {
  const coupon = await findCouponOrThrow(id);
  await coupon.deleteOne();
}

export async function updateCouponStatus(id: string, status: string) {
  return updateCoupon(id, { status });
}

interface CouponApplicationContext {
  customerId: string;
  locationId: string;
  businessType: string;
  vendorId?: string;
  storeId?: string;
  subtotal: number;
  // The order's line items' GLOBAL food item ids (FoodProduct, not
  // VendorFoodItem) — undefined/empty for INSTAMART orders, since
  // Coupon.foodItemIds only ever scopes Food items.
  foodItemIds?: string[];
}

// Validates a coupon code against the order actually being placed and
// returns the discount to apply, or throws a descriptive ApiError — called
// from order.service.createOrder inside the same transaction as order
// creation, so the usedCount increment below is atomic with the order that
// consumed it. Per-user usage is derived from Order history (couponCode +
// customerId, excluding CANCELLED orders) rather than a separate usage
// collection — Order already carries couponCode/couponDiscount, and a
// cancelled order's coupon use shouldn't count against a future limit since
// the discount never actually converted into revenue.
export async function applyCoupon(
  code: string,
  ctx: CouponApplicationContext,
  session: ClientSession,
): Promise<{ coupon: ICoupon; discount: number }> {
  const coupon = await Coupon.findOne({ code: code.toUpperCase() }).session(session);
  if (!coupon) throw ApiError.notFound('Coupon code not found', 'COUPON_NOT_FOUND');
  if (coupon.status !== GENERIC_STATUS.ACTIVE) {
    throw ApiError.unprocessable('This coupon is not currently active', 'COUPON_NOT_ACTIVE');
  }
  const now = new Date();
  if (now < coupon.startDate || now > coupon.endDate) {
    throw ApiError.unprocessable('This coupon is not valid at this time', 'COUPON_EXPIRED');
  }
  if (coupon.locationIds.length > 0 && !coupon.locationIds.some((id) => id.toString() === ctx.locationId)) {
    throw ApiError.unprocessable('This coupon is not valid for your location', 'COUPON_NOT_APPLICABLE');
  }
  if (coupon.businessTypes.length > 0 && !coupon.businessTypes.includes(ctx.businessType)) {
    throw ApiError.unprocessable('This coupon does not apply to this order type', 'COUPON_NOT_APPLICABLE');
  }
  if (coupon.vendorIds.length > 0 && (!ctx.vendorId || !coupon.vendorIds.some((id) => id.toString() === ctx.vendorId))) {
    throw ApiError.unprocessable('This coupon is not valid for this vendor', 'COUPON_NOT_APPLICABLE');
  }
  if (coupon.storeIds.length > 0 && (!ctx.storeId || !coupon.storeIds.some((id) => id.toString() === ctx.storeId))) {
    throw ApiError.unprocessable('This coupon is not valid for this store', 'COUPON_NOT_APPLICABLE');
  }
  if (coupon.foodItemIds.length > 0) {
    const orderedIds = new Set(ctx.foodItemIds ?? []);
    const matches = coupon.foodItemIds.some((id) => orderedIds.has(id.toString()));
    if (!matches) {
      throw ApiError.unprocessable('This coupon is not valid for the items in your order', 'COUPON_NOT_APPLICABLE');
    }
  }
  if (ctx.subtotal < coupon.minimumOrder) {
    throw ApiError.unprocessable(`This coupon requires a minimum order of ${coupon.minimumOrder}`, 'COUPON_MINIMUM_ORDER_NOT_MET');
  }
  if (coupon.usageLimit !== undefined && coupon.usedCount >= coupon.usageLimit) {
    throw ApiError.unprocessable('This coupon has reached its usage limit', 'COUPON_USAGE_LIMIT_REACHED');
  }

  const usedByCustomer = await Order.countDocuments({
    customerId: ctx.customerId,
    couponCode: coupon.code,
    status: { $ne: 'CANCELLED' },
  }).session(session);
  if (usedByCustomer >= (coupon.perUserLimit ?? 1)) {
    throw ApiError.unprocessable('You have already used this coupon the maximum number of times', 'COUPON_PER_USER_LIMIT_REACHED');
  }

  if (coupon.firstOrderOnly) {
    // Any non-cancelled order at all disqualifies them — deliberately not
    // scoped to this coupon's own code (that's what perUserLimit is for).
    const priorOrders = await Order.countDocuments({
      customerId: ctx.customerId,
      status: { $ne: 'CANCELLED' },
    }).session(session);
    if (priorOrders > 0) {
      throw ApiError.unprocessable('This coupon is only valid on your first order', 'COUPON_FIRST_ORDER_ONLY');
    }
  }

  let discount = coupon.discountType === DISCOUNT_TYPES.PERCENTAGE ? ctx.subtotal * (coupon.discountValue / 100) : coupon.discountValue;
  if (coupon.maximumDiscount !== undefined) discount = Math.min(discount, coupon.maximumDiscount);
  discount = Math.min(discount, ctx.subtotal);

  coupon.usedCount += 1;
  await coupon.save({ session });

  return { coupon, discount };
}
