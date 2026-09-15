import { FoodCategory } from '../models/FoodCategory';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { GENERIC_STATUS } from '../constants/enums';

// Fully global, admin-managed taxonomy (mirrors instamartCategory.service.ts)
// — every actor sees the same list; CUSTOMER/VENDOR only ever see ACTIVE ones,
// ADMIN sees every status.
export function foodCategoryListFilter(user: JwtPayload): Record<string, unknown> {
  if (user.userType === 'CUSTOMER' || user.userType === 'VENDOR') return { status: GENERIC_STATUS.ACTIVE };
  return {};
}

export async function listFoodCategories(
  filter: Record<string, unknown>,
  pagination: PaginationParams,
  user: JwtPayload,
) {
  // Re-asserted here (not just in foodCategoryListFilter) so an admin-only
  // query param merged in the controller (e.g. ?status=INACTIVE) can never leak
  // non-active categories to a customer/vendor.
  const query = user.userType === 'CUSTOMER' || user.userType === 'VENDOR' ? { ...filter, status: GENERIC_STATUS.ACTIVE } : filter;
  const [items, total] = await Promise.all([
    FoodCategory.find(query).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    FoodCategory.countDocuments(query),
  ]);
  return { items, total };
}

export async function createFoodCategory(data: Record<string, unknown>) {
  return FoodCategory.create(data);
}

// Exported for reuse by foodSubcategory.service.ts and vendorCatalogAccess.service.ts.
export async function findFoodCategoryOrThrow(id: string) {
  const category = await FoodCategory.findById(id);
  if (!category) throw ApiError.notFound('Food category not found', 'FOOD_CATEGORY_NOT_FOUND');
  return category;
}

export async function getFoodCategoryById(id: string, user: JwtPayload) {
  const category = await findFoodCategoryOrThrow(id);
  if ((user.userType === 'CUSTOMER' || user.userType === 'VENDOR') && category.status !== GENERIC_STATUS.ACTIVE) {
    throw ApiError.notFound('Food category not found', 'FOOD_CATEGORY_NOT_FOUND');
  }
  return category;
}

export async function updateFoodCategory(id: string, data: Record<string, unknown>) {
  const category = await findFoodCategoryOrThrow(id);
  Object.assign(category, data);
  await category.save();
  return category;
}

export async function deleteFoodCategory(id: string) {
  const category = await findFoodCategoryOrThrow(id);
  await category.deleteOne();
}

export async function updateFoodCategoryStatus(id: string, status: string) {
  return updateFoodCategory(id, { status });
}
