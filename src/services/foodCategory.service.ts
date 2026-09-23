import { FoodCategory, IFoodCategory } from '../models/FoodCategory';
import { FoodSubcategory } from '../models/FoodSubcategory';
import { FoodProduct } from '../models/FoodProduct';
import { FoodItemSubmission } from '../models/FoodItemSubmission';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { slugify } from '../utils/slug';
import { GENERIC_STATUS, FOOD_ITEM_SUBMISSION_STATUS } from '../constants/enums';

// Two kinds of category (see FoodCategory.ts): GLOBAL (vendorId: null,
// admin-managed, read-only for vendors) and VENDOR-OWNED (vendorId set,
// managed only by that vendor, invisible to every other vendor).

export function isOwnedBy(doc: { vendorId?: unknown }, vendorId: string): boolean {
  return !!doc.vendorId && String(doc.vendorId) === vendorId;
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Slugs are unique across the whole collection, so a vendor-owned record gets
// a vendor-specific suffix — two vendors can each have their own "Momos"
// without colliding with each other or with a global "Momos".
export function vendorScopedSlug(name: string, vendorId: string): string {
  return `${slugify(name)}-${vendorId.slice(-6)}`;
}

// What each actor may see:
// - VENDOR: every ACTIVE global category, plus all of its own (any status, so
//   it can re-activate one it switched off).
// - CUSTOMER: ACTIVE global categories, plus one vendor's ACTIVE own ones when
//   browsing that vendor (`vendorId` query param).
// - ADMIN: everything, optionally narrowed to one vendor's own categories.
export function foodCategoryListFilter(user: JwtPayload, vendorIdParam?: string): Record<string, unknown> {
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

export async function listFoodCategories(
  filter: Record<string, unknown>,
  pagination: PaginationParams,
  user: JwtPayload,
  vendorIdParam?: string,
) {
  // The actor's visibility rule is ANDed with any extra filter from the
  // controller, so an admin-only query param (e.g. ?status=INACTIVE) can
  // never widen what a customer/vendor sees.
  const query = { $and: [foodCategoryListFilter(user, vendorIdParam), filter] };
  const [items, total] = await Promise.all([
    FoodCategory.find(query).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    FoodCategory.countDocuments(query),
  ]);
  return { items, total };
}

// Exported for reuse by foodSubcategory.service.ts and vendorCatalogAccess.service.ts.
export async function findFoodCategoryOrThrow(id: string) {
  const category = await FoodCategory.findById(id);
  if (!category) throw ApiError.notFound('Food category not found', 'FOOD_CATEGORY_NOT_FOUND');
  return category;
}

// Whether `user` may see this category at all. Another vendor's private
// category is reported as not found rather than forbidden, so its existence
// doesn't leak.
export function canViewFoodCategory(category: IFoodCategory, user: JwtPayload): boolean {
  if (user.userType === 'ADMIN') return true;
  if (user.userType === 'VENDOR' && isOwnedBy(category, user.userId)) return true;
  if (category.status !== GENERIC_STATUS.ACTIVE) return false;
  // A CUSTOMER may view any ACTIVE category (a restaurant's own sections
  // included); a VENDOR only ACTIVE global ones beyond its own.
  return user.userType === 'CUSTOMER' || !category.vendorId;
}

export async function getFoodCategoryById(id: string, user: JwtPayload) {
  const category = await findFoodCategoryOrThrow(id);
  if (!canViewFoodCategory(category, user)) throw ApiError.notFound('Food category not found', 'FOOD_CATEGORY_NOT_FOUND');
  return category;
}

// Global categories are admin-only; a vendor may only change its own.
async function findWritableCategoryOrThrow(id: string, user: JwtPayload) {
  const category = await findFoodCategoryOrThrow(id);
  if (user.userType === 'VENDOR') {
    if (!category.vendorId) {
      throw ApiError.forbidden(
        'Global categories are managed by the marketplace admin and cannot be changed',
        'GLOBAL_CATEGORY_READ_ONLY',
      );
    }
    if (!isOwnedBy(category, user.userId)) throw ApiError.notFound('Food category not found', 'FOOD_CATEGORY_NOT_FOUND');
  }
  return category;
}

// A vendor's own category may not reuse the name of a global category (it
// should just use that one) or of another category it already owns.
async function assertVendorCategoryNameAvailable(vendorId: string, name: string, excludeId?: string) {
  const clash = await FoodCategory.findOne({
    name: { $regex: `^${escapeRegex(name.trim())}$`, $options: 'i' },
    $or: [{ vendorId: null }, { vendorId }],
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });
  if (!clash) return;
  if (!clash.vendorId) {
    throw ApiError.conflict(`A global category named "${clash.name}" already exists — use it instead`, 'CATEGORY_NAME_EXISTS_GLOBALLY');
  }
  throw ApiError.conflict(`You already have a category named "${clash.name}"`, 'CATEGORY_NAME_EXISTS');
}

export async function createFoodCategory(data: Record<string, unknown>, user: JwtPayload) {
  if (user.userType === 'VENDOR') {
    const name = data.name as string;
    await assertVendorCategoryNameAvailable(user.userId, name);
    // vendorId/slug are always server-derived for a vendor, never client-settable.
    return FoodCategory.create({ ...data, vendorId: user.userId, slug: vendorScopedSlug(name, user.userId) });
  }
  return FoodCategory.create({ ...data, vendorId: null });
}

export async function updateFoodCategory(id: string, data: Record<string, unknown>, user: JwtPayload) {
  const category = await findWritableCategoryOrThrow(id, user);
  const payload = { ...data };
  if (user.userType === 'VENDOR') {
    delete payload.slug;
    if (typeof payload.name === 'string') await assertVendorCategoryNameAvailable(user.userId, payload.name, category.id);
  }
  Object.assign(category, payload);
  await category.save();
  return category;
}

export async function deleteFoodCategory(id: string, user: JwtPayload) {
  const category = await findWritableCategoryOrThrow(id, user);
  // A vendor deleting its own category must empty it first, so no subcategory,
  // item, or still-pending item submission (which would otherwise be approved
  // into a category that no longer exists) is left pointing at it.
  if (user.userType === 'VENDOR') {
    const [subcategoryCount, itemCount, pendingSubmissionCount] = await Promise.all([
      FoodSubcategory.countDocuments({ categoryId: category._id }),
      FoodProduct.countDocuments({ categoryId: category._id }),
      FoodItemSubmission.countDocuments({ categoryId: category._id, status: FOOD_ITEM_SUBMISSION_STATUS.PENDING_APPROVAL }),
    ]);
    if (subcategoryCount > 0 || itemCount > 0 || pendingSubmissionCount > 0) {
      throw ApiError.conflict(
        'This category still has subcategories, items, or items awaiting approval — remove them first, or switch the category off instead',
        'CATEGORY_IN_USE',
      );
    }
  }
  await category.deleteOne();
}

export async function updateFoodCategoryStatus(id: string, status: string, user: JwtPayload) {
  return updateFoodCategory(id, { status }, user);
}
