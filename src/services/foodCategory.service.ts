import { FoodCategory } from '../models/FoodCategory';
import { Location } from '../models/Location';
import { Vendor } from '../models/Vendor';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { assertLocationAccess, locationScopeFilter } from '../middleware/rbac.middleware';
import { ADMIN_ROLES } from '../constants/roles';
import { GENERIC_STATUS } from '../constants/enums';

export function foodCategoryListFilter(user: JwtPayload): Record<string, unknown> {
  if (user.userType === 'VENDOR') return { vendorId: user.userId };
  if (user.userType === 'CUSTOMER') return { status: GENERIC_STATUS.ACTIVE };

  // Global categories (locationId: null) are always visible; location-scoped
  // admins additionally see only categories for their own location(s).
  const scope = locationScopeFilter(user);
  if (!scope.locationId) return {};
  return { $or: [{ locationId: null }, scope] };
}

export async function listFoodCategories(
  filter: Record<string, unknown>,
  pagination: PaginationParams,
  user: JwtPayload,
) {
  // Re-asserted here (not just in foodCategoryListFilter) so an admin/vendor-only
  // query param merged in the controller (e.g. ?status=INACTIVE) can never leak
  // non-active categories to a customer.
  const query = user.userType === 'CUSTOMER' ? { ...filter, status: GENERIC_STATUS.ACTIVE } : filter;
  const [items, total] = await Promise.all([
    FoodCategory.find(query).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    FoodCategory.countDocuments(query),
  ]);
  return { items, total };
}

export async function createFoodCategory(data: Record<string, unknown>, user: JwtPayload) {
  if (user.userType === 'VENDOR') {
    const vendor = await Vendor.findById(user.userId);
    if (!vendor) throw ApiError.notFound('Vendor not found', 'VENDOR_NOT_FOUND');
    return FoodCategory.create({ ...data, vendorId: vendor.id, locationId: vendor.locationId });
  }

  const locationId = data.locationId as string | null | undefined;

  if (!locationId) {
    if (user.role !== ADMIN_ROLES.SUPER_ADMIN) {
      throw ApiError.forbidden('Only a super admin can create a global category', 'GLOBAL_CATEGORY_FORBIDDEN');
    }
  } else {
    const locationExists = await Location.exists({ _id: locationId });
    if (!locationExists) throw ApiError.notFound('Location not found', 'LOCATION_NOT_FOUND');
    assertLocationAccess(user, locationId);
  }

  return FoodCategory.create(data);
}

async function findCategoryOrThrow(id: string) {
  const category = await FoodCategory.findById(id);
  if (!category) throw ApiError.notFound('Food category not found', 'FOOD_CATEGORY_NOT_FOUND');
  return category;
}

// Shared with foodSubcategory.service.ts, since a subcategory's access follows
// its parent category. VENDOR may only touch their own private category;
// CUSTOMER may only read an ACTIVE one; ADMIN follows ordinary location
// scoping, except a global (locationId: null) category, which only a super
// admin may write.
export function assertCategoryAccess(
  user: JwtPayload,
  category: { vendorId?: unknown; locationId?: unknown; status?: string },
): void {
  if (user.userType === 'VENDOR') {
    if (!category.vendorId || (category.vendorId as { toString(): string }).toString() !== user.userId) {
      throw ApiError.forbidden('You do not have access to this resource', 'OWNER_FORBIDDEN');
    }
    return;
  }

  if (user.userType === 'CUSTOMER') {
    if (category.status !== GENERIC_STATUS.ACTIVE) {
      throw ApiError.notFound('Food category not found', 'FOOD_CATEGORY_NOT_FOUND');
    }
    return;
  }

  if (category.locationId) {
    assertLocationAccess(user, (category.locationId as { toString(): string }).toString());
  } else if (user.role !== ADMIN_ROLES.SUPER_ADMIN) {
    throw ApiError.forbidden('Only a super admin can manage a global category', 'GLOBAL_CATEGORY_FORBIDDEN');
  }
}

export async function getFoodCategoryById(id: string, user: JwtPayload) {
  const category = await findCategoryOrThrow(id);
  assertCategoryAccess(user, category);
  return category;
}

export async function updateFoodCategory(id: string, data: Record<string, unknown>, user: JwtPayload) {
  const category = await findCategoryOrThrow(id);
  assertCategoryAccess(user, category);

  // Neither actor may reassign a category to a different vendor/location via update.
  delete data.vendorId;
  delete data.locationId;

  Object.assign(category, data);
  await category.save();
  return category;
}

export async function deleteFoodCategory(id: string, user: JwtPayload) {
  const category = await findCategoryOrThrow(id);
  assertCategoryAccess(user, category);
  await category.deleteOne();
}

export async function updateFoodCategoryStatus(id: string, status: string, user: JwtPayload) {
  return updateFoodCategory(id, { status }, user);
}
