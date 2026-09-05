import mongoose, { ClientSession, Model } from 'mongoose';
import { Review, IReview } from '../models/Review';
import { Order } from '../models/Order';
import { OrderItem } from '../models/OrderItem';
import { Vendor } from '../models/Vendor';
import { Store } from '../models/Store';
import { DeliveryPartner } from '../models/DeliveryPartner';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { REVIEW_TARGET_TYPES, REVIEW_STATUS } from '../constants/enums';
import { ADMIN_ROLES } from '../constants/roles';
import { ROLE_DEFAULT_PERMISSIONS, PERMISSIONS } from '../constants/permissions';

// Only these target types carry an aggregate rating/ratingCount field to
// keep in sync (see Vendor/Store/DeliveryPartner models). PRODUCT reviews
// are valid but there's no product-level rating field in this scaffold to
// write into, so they're simply not in this map. Each concrete Model<IVendor
// | IStore | IDeliveryPartner> is structurally incompatible with a shared
// Model<{rating,ratingCount}> parameter (Mongoose's Model type isn't
// covariant), so the map is typed loosely and cast at the call site —
// `updateOne({_id}, {rating, ratingCount})` only ever touches those two
// fields regardless of the document's full shape.
type RatingBearingModel = Model<Record<string, unknown>>;
const RATING_TARGET_MODELS: Partial<Record<string, RatingBearingModel>> = {
  [REVIEW_TARGET_TYPES.VENDOR]: Vendor as unknown as RatingBearingModel,
  [REVIEW_TARGET_TYPES.STORE]: Store as unknown as RatingBearingModel,
  [REVIEW_TARGET_TYPES.DELIVERY_PARTNER]: DeliveryPartner as unknown as RatingBearingModel,
};

async function recomputeTargetRating(targetType: string, targetId: string, session: ClientSession): Promise<void> {
  const TargetModel = RATING_TARGET_MODELS[targetType];
  if (!TargetModel) return;

  const [agg] = await Review.aggregate([
    { $match: { targetType, targetId: new mongoose.Types.ObjectId(targetId), status: REVIEW_STATUS.VISIBLE } },
    { $group: { _id: null, avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]).session(session);

  await TargetModel.updateOne(
    { _id: targetId },
    { rating: agg ? Math.round(agg.avgRating * 10) / 10 : 0, ratingCount: agg ? agg.count : 0 },
  ).session(session);
}

async function assertReviewable(orderId: string, targetType: string, targetId: string, customerId: string): Promise<void> {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound('Order not found', 'ORDER_NOT_FOUND');
  if (order.customerId.toString() !== customerId) {
    throw ApiError.forbidden('You do not have access to this order', 'ORDER_FORBIDDEN');
  }
  if (order.status !== 'DELIVERED') {
    throw ApiError.unprocessable('You can only review an order once it has been delivered', 'ORDER_NOT_DELIVERED');
  }

  let matches: boolean;
  switch (targetType) {
    case REVIEW_TARGET_TYPES.VENDOR:
      matches = order.vendorId?.toString() === targetId;
      break;
    case REVIEW_TARGET_TYPES.STORE:
      matches = order.storeId?.toString() === targetId;
      break;
    case REVIEW_TARGET_TYPES.DELIVERY_PARTNER:
      matches = order.deliveryPartnerId?.toString() === targetId;
      break;
    case REVIEW_TARGET_TYPES.PRODUCT:
      matches = await OrderItem.exists({ orderId, productId: targetId }).then(Boolean);
      break;
    default:
      matches = false;
  }
  if (!matches) {
    throw ApiError.badRequest('This target was not part of the order being reviewed', 'REVIEW_TARGET_MISMATCH');
  }
}

export async function createReview(
  customerId: string,
  data: { orderId: string; targetType: string; targetId: string; rating: number; comment?: string; images: string[] },
) {
  await assertReviewable(data.orderId, data.targetType, data.targetId, customerId);

  const existing = await Review.findOne({ orderId: data.orderId, targetType: data.targetType, targetId: data.targetId });
  if (existing) throw ApiError.conflict('You have already reviewed this for this order', 'REVIEW_ALREADY_EXISTS');

  const session = await mongoose.startSession();
  try {
    let created: InstanceType<typeof Review> | undefined;
    await session.withTransaction(async () => {
      const [review] = await Review.create(
        [
          {
            customerId,
            orderId: data.orderId,
            targetType: data.targetType,
            targetId: data.targetId,
            rating: data.rating,
            comment: data.comment,
            images: data.images,
          },
        ],
        { session },
      );
      await recomputeTargetRating(data.targetType, data.targetId, session);
      created = review;
    });
    return created!;
  } finally {
    await session.endSession();
  }
}

async function findReviewOrThrow(id: string) {
  const review = await Review.findById(id);
  if (!review) throw ApiError.notFound('Review not found', 'REVIEW_NOT_FOUND');
  return review;
}

function hasReviewViewPermission(user?: JwtPayload): boolean {
  if (!user || user.userType !== 'ADMIN') return false;
  if (user.role === ADMIN_ROLES.SUPER_ADMIN) return true;
  return (ROLE_DEFAULT_PERMISSIONS[user.role] ?? []).includes(PERMISSIONS.REVIEW_VIEW);
}

function canSeeHidden(review: IReview, user?: JwtPayload): boolean {
  if (!user) return false;
  if (user.userType === 'CUSTOMER' && review.customerId.toString() === user.userId) return true;
  return hasReviewViewPermission(user);
}

// Public browsing filter: VISIBLE only for anonymous/ordinary callers; an
// admin with REVIEW_VIEW (moderation) sees everything; a logged-in customer
// additionally sees their own HIDDEN reviews (so they know what happened to
// something they wrote).
export function reviewListFilter(user: JwtPayload | undefined, extra: Record<string, unknown>): Record<string, unknown> {
  if (hasReviewViewPermission(user)) return extra;
  if (user?.userType === 'CUSTOMER') {
    return { ...extra, $or: [{ status: REVIEW_STATUS.VISIBLE }, { customerId: user.userId }] };
  }
  return { ...extra, status: REVIEW_STATUS.VISIBLE };
}

export async function listReviews(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total] = await Promise.all([
    Review.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    Review.countDocuments(filter),
  ]);
  return { items, total };
}

export async function getReviewById(id: string, user: JwtPayload | undefined) {
  const review = await findReviewOrThrow(id);
  if (review.status !== REVIEW_STATUS.VISIBLE && !canSeeHidden(review, user)) {
    // Don't distinguish "hidden" from "doesn't exist" to an unprivileged caller.
    throw ApiError.notFound('Review not found', 'REVIEW_NOT_FOUND');
  }
  return review;
}

function assertOwnReview(review: IReview, user: JwtPayload): void {
  if (user.userType !== 'CUSTOMER' || review.customerId.toString() !== user.userId) {
    throw ApiError.forbidden('You do not have access to this review', 'REVIEW_FORBIDDEN');
  }
}

export async function updateReview(
  id: string,
  data: { rating?: number; comment?: string; images?: string[] },
  user: JwtPayload,
) {
  const review = await findReviewOrThrow(id);
  assertOwnReview(review, user);

  const session = await mongoose.startSession();
  try {
    let updated: InstanceType<typeof Review> | undefined;
    await session.withTransaction(async () => {
      Object.assign(review, data);
      await review.save({ session });
      await recomputeTargetRating(review.targetType, review.targetId.toString(), session);
      updated = review;
    });
    return updated!;
  } finally {
    await session.endSession();
  }
}

// Deletable by the review's own author, or an admin with REVIEW_MODERATE
// (e.g. removing content that violates policy outright rather than just
// hiding it).
function assertCanDelete(review: IReview, user: JwtPayload): void {
  if (user.userType === 'CUSTOMER' && review.customerId.toString() === user.userId) return;
  if (hasReviewViewPermission(user) && (ROLE_DEFAULT_PERMISSIONS[user.role] ?? []).includes(PERMISSIONS.REVIEW_MODERATE)) return;
  if (user.userType === 'ADMIN' && user.role === ADMIN_ROLES.SUPER_ADMIN) return;
  throw ApiError.forbidden('You do not have access to this review', 'REVIEW_FORBIDDEN');
}

export async function deleteReview(id: string, user: JwtPayload) {
  const review = await findReviewOrThrow(id);
  assertCanDelete(review, user);

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await review.deleteOne({ session });
      await recomputeTargetRating(review.targetType, review.targetId.toString(), session);
    });
  } finally {
    await session.endSession();
  }
}

export async function updateReviewStatus(id: string, status: string) {
  const review = await findReviewOrThrow(id);

  const session = await mongoose.startSession();
  try {
    let updated: InstanceType<typeof Review> | undefined;
    await session.withTransaction(async () => {
      review.status = status;
      await review.save({ session });
      await recomputeTargetRating(review.targetType, review.targetId.toString(), session);
      updated = review;
    });
    return updated!;
  } finally {
    await session.endSession();
  }
}
