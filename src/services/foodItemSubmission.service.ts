import mongoose from 'mongoose';
import { FoodItemSubmission } from '../models/FoodItemSubmission';
import { FoodProduct } from '../models/FoodProduct';
import { VendorFoodItem } from '../models/VendorFoodItem';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { FOOD_ITEM_SUBMISSION_STATUS, GLOBAL_FOOD_ITEM_STATUS } from '../constants/enums';
import { assertCategoryAndSubcategoryExist, assertVendorHasCatalogAccess } from './vendorCatalogAccess.service';

// A vendor's "this item doesn't exist in the catalog yet" proposal (spec
// §12) — mirrors instamartProduct.service.ts's store-submits-a-new-product
// flow, but with an explicit admin-approval gate rather than auto-approve
// (see approveFoodItemSubmission below).
export async function createFoodItemSubmission(vendorId: string, data: Record<string, unknown>) {
  const categoryId = data.categoryId as string;
  const subcategoryId = (data.subcategoryId as string | undefined) ?? null;

  await assertCategoryAndSubcategoryExist(categoryId, subcategoryId);
  // A vendor may only propose an item under a category/subcategory it has
  // been explicitly granted (same allow-list as adding an existing item —
  // see vendorFoodItem.service.ts's addVendorFoodItem).
  await assertVendorHasCatalogAccess(vendorId, categoryId, subcategoryId);

  return FoodItemSubmission.create({ ...data, vendorId, status: FOOD_ITEM_SUBMISSION_STATUS.PENDING_APPROVAL });
}

// A vendor sees only their own submissions; an admin sees every vendor's.
export function foodItemSubmissionListFilter(user: JwtPayload): Record<string, unknown> {
  if (user.userType === 'VENDOR') return { vendorId: user.userId };
  return {};
}

export async function listFoodItemSubmissions(
  filter: Record<string, unknown>,
  pagination: PaginationParams,
  user: JwtPayload,
) {
  const query = { ...filter, ...foodItemSubmissionListFilter(user) };
  const [items, total] = await Promise.all([
    FoodItemSubmission.find(query).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    FoodItemSubmission.countDocuments(query),
  ]);
  return { items, total };
}

async function findSubmissionOrThrow(id: string) {
  const submission = await FoodItemSubmission.findById(id);
  if (!submission) throw ApiError.notFound('Food item submission not found', 'FOOD_ITEM_SUBMISSION_NOT_FOUND');
  return submission;
}

function assertSubmissionAccess(submission: { vendorId: { toString(): string } }, user: JwtPayload): void {
  if (user.userType === 'VENDOR' && submission.vendorId.toString() !== user.userId) {
    throw ApiError.forbidden('You do not have access to this resource', 'OWNER_FORBIDDEN');
  }
}

export async function getFoodItemSubmissionById(id: string, user: JwtPayload) {
  const submission = await findSubmissionOrThrow(id);
  assertSubmissionAccess(submission, user);
  return submission;
}

// Admin-only (enforced at the route level): edits fields before approving —
// only while still PENDING_APPROVAL.
export async function updateFoodItemSubmission(id: string, data: Record<string, unknown>) {
  const submission = await findSubmissionOrThrow(id);
  if (submission.status !== FOOD_ITEM_SUBMISSION_STATUS.PENDING_APPROVAL) {
    throw ApiError.badRequest('Only a pending submission can be edited', 'FOOD_ITEM_SUBMISSION_NOT_PENDING');
  }

  if (data.categoryId || data.subcategoryId) {
    const categoryId = (data.categoryId as string | undefined) ?? submission.categoryId.toString();
    const subcategoryId = (data.subcategoryId as string | undefined) ?? submission.subcategoryId?.toString() ?? null;
    await assertCategoryAndSubcategoryExist(categoryId, subcategoryId);
  }

  delete data.vendorId;
  delete data.status;
  Object.assign(submission, data);
  await submission.save();
  return submission;
}

// Admin-only (enforced at the route level): transactionally creates the
// GLOBAL FoodProduct (submittedByVendorId = the submitting vendor) plus a
// VendorFoodItem for that vendor using the proposed price/mrp/preparationTime.
export async function approveFoodItemSubmission(id: string, user: JwtPayload) {
  const submission = await findSubmissionOrThrow(id);
  if (submission.status !== FOOD_ITEM_SUBMISSION_STATUS.PENDING_APPROVAL) {
    throw ApiError.badRequest('Only a pending submission can be approved', 'FOOD_ITEM_SUBMISSION_NOT_PENDING');
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const [globalItem] = await FoodProduct.create(
        [
          {
            categoryId: submission.categoryId,
            subcategoryId: submission.subcategoryId,
            name: submission.name,
            description: submission.description,
            images: submission.image ? [submission.image] : [],
            foodType: submission.foodType,
            status: GLOBAL_FOOD_ITEM_STATUS.ACTIVE,
            submittedByVendorId: submission.vendorId,
          },
        ],
        { session },
      );

      await VendorFoodItem.create(
        [
          {
            vendorId: submission.vendorId,
            globalFoodItemId: globalItem.id,
            price: submission.price,
            mrp: submission.mrp,
            preparationTime: submission.preparationTime,
          },
        ],
        { session },
      );

      submission.status = FOOD_ITEM_SUBMISSION_STATUS.APPROVED;
      submission.resultingGlobalFoodItemId = globalItem._id;
      submission.reviewedBy = new mongoose.Types.ObjectId(user.userId);
      submission.reviewedAt = new Date();
      await submission.save({ session });
    });
  } finally {
    await session.endSession();
  }

  return submission;
}

export async function rejectFoodItemSubmission(id: string, reason: string, user: JwtPayload) {
  const submission = await findSubmissionOrThrow(id);
  if (submission.status !== FOOD_ITEM_SUBMISSION_STATUS.PENDING_APPROVAL) {
    throw ApiError.badRequest('Only a pending submission can be rejected', 'FOOD_ITEM_SUBMISSION_NOT_PENDING');
  }

  submission.status = FOOD_ITEM_SUBMISSION_STATUS.REJECTED;
  submission.rejectionReason = reason;
  submission.reviewedBy = user.userId as unknown as typeof submission.reviewedBy;
  submission.reviewedAt = new Date();
  await submission.save();
  return submission;
}
