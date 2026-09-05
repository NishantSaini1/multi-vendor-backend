import { FoodSubcategory } from '../models/FoodSubcategory';
import { FoodCategory } from '../models/FoodCategory';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { GENERIC_STATUS } from '../constants/enums';
import { foodCategoryListFilter, assertCategoryAccess } from './foodCategory.service';

async function findCategoryOrThrow(categoryId: string) {
  const category = await FoodCategory.findById(categoryId);
  if (!category) throw ApiError.notFound('Food category not found', 'FOOD_CATEGORY_NOT_FOUND');
  return category;
}

export async function listFoodSubcategories(
  filter: { categoryId?: string; status?: string },
  pagination: PaginationParams,
  user: JwtPayload,
) {
  const mongoFilter: Record<string, unknown> = {};
  if (filter.status) mongoFilter.status = filter.status;
  // Re-asserted after the line above so a non-customer-only status filter can
  // never leak non-active subcategories to a customer.
  if (user.userType === 'CUSTOMER') mongoFilter.status = GENERIC_STATUS.ACTIVE;

  if (filter.categoryId) {
    const category = await findCategoryOrThrow(filter.categoryId);
    assertCategoryAccess(user, category);
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

export async function createFoodSubcategory(data: { categoryId: string; [key: string]: unknown }, user: JwtPayload) {
  const category = await findCategoryOrThrow(data.categoryId);
  assertCategoryAccess(user, category);
  return FoodSubcategory.create(data);
}

async function findSubcategoryOrThrow(id: string) {
  const subcategory = await FoodSubcategory.findById(id);
  if (!subcategory) throw ApiError.notFound('Food subcategory not found', 'FOOD_SUBCATEGORY_NOT_FOUND');
  return subcategory;
}

export async function getFoodSubcategoryById(id: string, user: JwtPayload) {
  const subcategory = await findSubcategoryOrThrow(id);
  const category = await findCategoryOrThrow(subcategory.categoryId.toString());
  assertCategoryAccess(user, category);
  if (user.userType === 'CUSTOMER' && subcategory.status !== GENERIC_STATUS.ACTIVE) {
    throw ApiError.notFound('Food subcategory not found', 'FOOD_SUBCATEGORY_NOT_FOUND');
  }
  return subcategory;
}

export async function updateFoodSubcategory(id: string, data: Record<string, unknown>, user: JwtPayload) {
  const subcategory = await findSubcategoryOrThrow(id);
  const category = await findCategoryOrThrow(subcategory.categoryId.toString());
  assertCategoryAccess(user, category);

  if (data.categoryId) {
    const newCategory = await findCategoryOrThrow(data.categoryId as string);
    assertCategoryAccess(user, newCategory);
  }

  Object.assign(subcategory, data);
  await subcategory.save();
  return subcategory;
}

export async function deleteFoodSubcategory(id: string, user: JwtPayload) {
  const subcategory = await findSubcategoryOrThrow(id);
  const category = await findCategoryOrThrow(subcategory.categoryId.toString());
  assertCategoryAccess(user, category);
  await subcategory.deleteOne();
}

export async function updateFoodSubcategoryStatus(id: string, status: string, user: JwtPayload) {
  return updateFoodSubcategory(id, { status }, user);
}
