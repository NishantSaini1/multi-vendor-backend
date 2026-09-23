import { FoodSubcategory, IFoodSubcategory } from '../models/FoodSubcategory';
import { FoodCategory } from '../models/FoodCategory';
import { FoodProduct } from '../models/FoodProduct';
import { FoodItemSubmission } from '../models/FoodItemSubmission';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { GENERIC_STATUS, FOOD_ITEM_SUBMISSION_STATUS } from '../constants/enums';
import {
  foodCategoryListFilter,
  findFoodCategoryOrThrow,
  canViewFoodCategory,
  isOwnedBy,
  escapeRegex,
  vendorScopedSlug,
} from './foodCategory.service';

// Same GLOBAL vs VENDOR-OWNED split as foodCategory.service.ts. On top of the
// subcategory's own visibility, its parent category must be visible to the
// actor too.
function subcategoryVisibilityFilter(user: JwtPayload, vendorIdParam?: string): Record<string, unknown> {
  if (user.userType === 'VENDOR') {
    return { $or: [{ vendorId: null, status: GENERIC_STATUS.ACTIVE }, { vendorId: user.userId }] };
  }
  if (user.userType === 'CUSTOMER') {
    const visible: Record<string, unknown>[] = [{ vendorId: null }];
    if (vendorIdParam) visible.push({ vendorId: vendorIdParam });
    return { status: GENERIC_STATUS.ACTIVE, $or: visible };
  }
  return vendorIdParam ? { vendorId: vendorIdParam } : {};
}

export async function listFoodSubcategories(
  filter: { categoryId?: string; status?: string; vendorId?: string },
  pagination: PaginationParams,
  user: JwtPayload,
) {
  const clauses: Record<string, unknown>[] = [subcategoryVisibilityFilter(user, filter.vendorId)];
  // Admin-only extra filter — ANDed, so it can never widen what others see.
  if (filter.status && user.userType === 'ADMIN') clauses.push({ status: filter.status });

  if (filter.categoryId) {
    const category = await findFoodCategoryOrThrow(filter.categoryId);
    if (!canViewFoodCategory(category, user)) throw ApiError.notFound('Food category not found', 'FOOD_CATEGORY_NOT_FOUND');
    clauses.push({ categoryId: filter.categoryId });
  } else {
    const accessibleCategoryIds = await FoodCategory.find(foodCategoryListFilter(user, filter.vendorId)).distinct('_id');
    clauses.push({ categoryId: { $in: accessibleCategoryIds } });
  }

  const query = { $and: clauses };
  const [items, total] = await Promise.all([
    FoodSubcategory.find(query).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    FoodSubcategory.countDocuments(query),
  ]);
  return { items, total };
}

// The category a subcategory is being created under / moved to. A vendor may
// only use an ACTIVE global category or one of its own — never another
// vendor's (reported as not found).
async function resolveParentCategory(categoryId: string, user: JwtPayload) {
  const category = await findFoodCategoryOrThrow(categoryId);
  if (user.userType === 'VENDOR' && !canViewFoodCategory(category, user)) {
    throw ApiError.notFound('Food category not found', 'FOOD_CATEGORY_NOT_FOUND');
  }
  return category;
}

// Within one category, a vendor's own subcategory may not reuse the name of a
// global subcategory there (it should just use that one) or of another one it
// already owns there.
async function assertVendorSubcategoryNameAvailable(vendorId: string, categoryId: string, name: string, excludeId?: string) {
  const clash = await FoodSubcategory.findOne({
    categoryId,
    name: { $regex: `^${escapeRegex(name.trim())}$`, $options: 'i' },
    $or: [{ vendorId: null }, { vendorId }],
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });
  if (!clash) return;
  if (!clash.vendorId) {
    throw ApiError.conflict(
      `A global subcategory named "${clash.name}" already exists in this category — use it instead`,
      'SUBCATEGORY_NAME_EXISTS_GLOBALLY',
    );
  }
  throw ApiError.conflict(`You already have a subcategory named "${clash.name}" in this category`, 'SUBCATEGORY_NAME_EXISTS');
}

export async function createFoodSubcategory(data: { categoryId: string; [key: string]: unknown }, user: JwtPayload) {
  const category = await resolveParentCategory(data.categoryId, user);

  if (user.userType === 'VENDOR') {
    const name = data.name as string;
    await assertVendorSubcategoryNameAvailable(user.userId, data.categoryId, name);
    // vendorId/slug are always server-derived for a vendor, never client-settable.
    return FoodSubcategory.create({ ...data, vendorId: user.userId, slug: vendorScopedSlug(name, user.userId) });
  }

  // An admin adding a subcategory under a vendor's own category keeps it owned
  // by that vendor, so a private category never contains a global subcategory.
  return FoodSubcategory.create({ ...data, vendorId: category.vendorId ?? null });
}

async function findSubcategoryOrThrow(id: string) {
  const subcategory = await FoodSubcategory.findById(id);
  if (!subcategory) throw ApiError.notFound('Food subcategory not found', 'FOOD_SUBCATEGORY_NOT_FOUND');
  return subcategory;
}

function canViewFoodSubcategory(subcategory: IFoodSubcategory, user: JwtPayload): boolean {
  if (user.userType === 'ADMIN') return true;
  if (user.userType === 'VENDOR' && isOwnedBy(subcategory, user.userId)) return true;
  if (subcategory.status !== GENERIC_STATUS.ACTIVE) return false;
  return user.userType === 'CUSTOMER' || !subcategory.vendorId;
}

export async function getFoodSubcategoryById(id: string, user: JwtPayload) {
  const subcategory = await findSubcategoryOrThrow(id);
  if (!canViewFoodSubcategory(subcategory, user)) {
    throw ApiError.notFound('Food subcategory not found', 'FOOD_SUBCATEGORY_NOT_FOUND');
  }
  return subcategory;
}

// Global subcategories are admin-only; a vendor may only change its own.
async function findWritableSubcategoryOrThrow(id: string, user: JwtPayload) {
  const subcategory = await findSubcategoryOrThrow(id);
  if (user.userType === 'VENDOR') {
    if (!subcategory.vendorId) {
      throw ApiError.forbidden(
        'Global subcategories are managed by the marketplace admin and cannot be changed',
        'GLOBAL_SUBCATEGORY_READ_ONLY',
      );
    }
    if (!isOwnedBy(subcategory, user.userId)) {
      throw ApiError.notFound('Food subcategory not found', 'FOOD_SUBCATEGORY_NOT_FOUND');
    }
  }
  return subcategory;
}

export async function updateFoodSubcategory(id: string, data: Record<string, unknown>, user: JwtPayload) {
  const subcategory = await findWritableSubcategoryOrThrow(id, user);
  const payload = { ...data };

  const targetCategoryId = (payload.categoryId as string | undefined) ?? subcategory.categoryId.toString();
  if (payload.categoryId) {
    const category = await resolveParentCategory(payload.categoryId as string, user);
    // A subcategory can't be moved into a private category owned by someone
    // other than its own owner (or, for a global one, into any private one).
    if (category.vendorId && String(category.vendorId) !== String(subcategory.vendorId ?? '')) {
      throw ApiError.badRequest(
        "A subcategory can't be moved into another owner's category",
        'SUBCATEGORY_CATEGORY_OWNER_MISMATCH',
      );
    }
  }

  if (user.userType === 'VENDOR') {
    delete payload.slug;
    const name = (payload.name as string | undefined) ?? subcategory.name;
    if (payload.name || payload.categoryId) {
      await assertVendorSubcategoryNameAvailable(user.userId, targetCategoryId, name, subcategory.id);
    }
  }

  Object.assign(subcategory, payload);
  await subcategory.save();
  return subcategory;
}

export async function deleteFoodSubcategory(id: string, user: JwtPayload) {
  const subcategory = await findWritableSubcategoryOrThrow(id, user);
  // A vendor deleting its own subcategory must empty it first (items and
  // still-pending item submissions alike).
  if (user.userType === 'VENDOR') {
    const [itemCount, pendingSubmissionCount] = await Promise.all([
      FoodProduct.countDocuments({ subcategoryId: subcategory._id }),
      FoodItemSubmission.countDocuments({ subcategoryId: subcategory._id, status: FOOD_ITEM_SUBMISSION_STATUS.PENDING_APPROVAL }),
    ]);
    if (itemCount > 0 || pendingSubmissionCount > 0) {
      throw ApiError.conflict(
        'This subcategory still has items or items awaiting approval — remove them first, or switch the subcategory off instead',
        'SUBCATEGORY_IN_USE',
      );
    }
  }
  await subcategory.deleteOne();
}

export async function updateFoodSubcategoryStatus(id: string, status: string, user: JwtPayload) {
  return updateFoodSubcategory(id, { status }, user);
}
