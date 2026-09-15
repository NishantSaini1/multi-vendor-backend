import { FoodSubcategory } from '../models/FoodSubcategory';
import { FoodCategory } from '../models/FoodCategory';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { GENERIC_STATUS } from '../constants/enums';
import { foodCategoryListFilter, findFoodCategoryOrThrow } from './foodCategory.service';

export async function listFoodSubcategories(
  filter: { categoryId?: string; status?: string },
  pagination: PaginationParams,
  user: JwtPayload,
) {
  const mongoFilter: Record<string, unknown> = {};
  if (filter.status) mongoFilter.status = filter.status;
  // Re-asserted after the line above so a non-customer/vendor-only status
  // filter can never leak non-active subcategories to them.
  if (user.userType === 'CUSTOMER' || user.userType === 'VENDOR') mongoFilter.status = GENERIC_STATUS.ACTIVE;

  if (filter.categoryId) {
    await findFoodCategoryOrThrow(filter.categoryId);
    mongoFilter.categoryId = filter.categoryId;
  } else {
    const accessibleCategoryIds = await FoodCategory.find(foodCategoryListFilter(user)).distinct('_id');
    mongoFilter.categoryId = { $in: accessibleCategoryIds };
  }

  const [items, total] = await Promise.all([
    FoodSubcategory.find(mongoFilter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    FoodSubcategory.countDocuments(mongoFilter),
  ]);
  return { items, total };
}

export async function createFoodSubcategory(data: { categoryId: string; [key: string]: unknown }) {
  await findFoodCategoryOrThrow(data.categoryId);
  return FoodSubcategory.create(data);
}

async function findSubcategoryOrThrow(id: string) {
  const subcategory = await FoodSubcategory.findById(id);
  if (!subcategory) throw ApiError.notFound('Food subcategory not found', 'FOOD_SUBCATEGORY_NOT_FOUND');
  return subcategory;
}

export async function getFoodSubcategoryById(id: string, user: JwtPayload) {
  const subcategory = await findSubcategoryOrThrow(id);
  if ((user.userType === 'CUSTOMER' || user.userType === 'VENDOR') && subcategory.status !== GENERIC_STATUS.ACTIVE) {
    throw ApiError.notFound('Food subcategory not found', 'FOOD_SUBCATEGORY_NOT_FOUND');
  }
  return subcategory;
}

export async function updateFoodSubcategory(id: string, data: Record<string, unknown>) {
  const subcategory = await findSubcategoryOrThrow(id);

  if (data.categoryId) {
    await findFoodCategoryOrThrow(data.categoryId as string);
  }

  Object.assign(subcategory, data);
  await subcategory.save();
  return subcategory;
}

export async function deleteFoodSubcategory(id: string) {
  const subcategory = await findSubcategoryOrThrow(id);
  await subcategory.deleteOne();
}

export async function updateFoodSubcategoryStatus(id: string, status: string) {
  return updateFoodSubcategory(id, { status });
}
