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

  let discount = coupon.discountType === DISCOUNT_TYPES.PERCENTAGE ? ctx.subtotal * (coupon.discountValue / 100) : coupon.discountValue;
  if (coupon.maximumDiscount !== undefined) discount = Math.min(discount, coupon.maximumDiscount);
  discount = Math.min(discount, ctx.subtotal);

  coupon.usedCount += 1;
  await coupon.save({ session });

  return { coupon, discount };
}
