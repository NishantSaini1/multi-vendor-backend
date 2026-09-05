import { InstamartCategory } from '../models/InstamartCategory';
import { InstamartSubcategory } from '../models/InstamartSubcategory';
import { Location } from '../models/Location';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { assertLocationAccess, locationScopeFilter } from '../middleware/rbac.middleware';
import { ADMIN_ROLES } from '../constants/roles';
import { GENERIC_STATUS } from '../constants/enums';

// CUSTOMER browses every location's ACTIVE catalog (no location scoping —
// mirrors foodCategoryListFilter); ADMIN follows ordinary location scoping,
// with global (locationId: null) categories always visible.
export function instamartCategoryListFilter(user: JwtPayload): Record<string, unknown> {
  if (user.userType === 'CUSTOMER') return { status: GENERIC_STATUS.ACTIVE };

  const scope = locationScopeFilter(user);
  if (!scope.locationId) return {};
  return { $or: [{ locationId: null }, scope] };
}

// CUSTOMER may only read an ACTIVE category, regardless of location; ADMIN
// follows ordinary location scoping, except a global category, which only a
// super admin may write.
function assertGlobalOrLocationAccess(
  user: JwtPayload,
  locationId: unknown,
  action: string,
  status?: string,
): void {
  if (user.userType === 'CUSTOMER') {
    if (status !== GENERIC_STATUS.ACTIVE) {
      throw ApiError.notFound('Instamart category not found', 'INSTAMART_CATEGORY_NOT_FOUND');
    }
    return;
  }

  if (locationId) {
    assertLocationAccess(user, (locationId as { toString(): string }).toString());
  } else if (user.role !== ADMIN_ROLES.SUPER_ADMIN) {
    throw ApiError.forbidden(`Only a super admin can ${action} a global category`, 'GLOBAL_CATEGORY_FORBIDDEN');
  }
}

// --- Categories ---

export async function listInstamartCategories(
  filter: Record<string, unknown>,
  pagination: PaginationParams,
  user: JwtPayload,
) {
  // Re-asserted here (not just in instamartCategoryListFilter) so an admin-only
  // query param merged in the controller (e.g. ?status=INACTIVE) can never leak
  // non-active categories to a customer.
  const query = user.userType === 'CUSTOMER' ? { ...filter, status: GENERIC_STATUS.ACTIVE } : filter;
  const [items, total] = await Promise.all([
    InstamartCategory.find(query).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    InstamartCategory.countDocuments(query),
  ]);
  return { items, total };
}

export async function createInstamartCategory(data: Record<string, unknown>, user: JwtPayload) {
  const locationId = data.locationId as string | null | undefined;
  if (locationId) {
    const locationExists = await Location.exists({ _id: locationId });
    if (!locationExists) throw ApiError.notFound('Location not found', 'LOCATION_NOT_FOUND');
  }
  assertGlobalOrLocationAccess(user, locationId, 'create');
  return InstamartCategory.create(data);
}

async function findCategoryOrThrow(id: string) {
  const category = await InstamartCategory.findById(id);
  if (!category) throw ApiError.notFound('Instamart category not found', 'INSTAMART_CATEGORY_NOT_FOUND');
  return category;
}

export async function getInstamartCategoryById(id: string, user: JwtPayload) {
  const category = await findCategoryOrThrow(id);
  assertGlobalOrLocationAccess(user, category.locationId, 'view', category.status);
  return category;
}

export async function updateInstamartCategory(id: string, data: Record<string, unknown>, user: JwtPayload) {
  const category = await findCategoryOrThrow(id);
  assertGlobalOrLocationAccess(user, category.locationId, 'edit');
  Object.assign(category, data);
  await category.save();
  return category;
}

export async function deleteInstamartCategory(id: string, user: JwtPayload) {
  const category = await findCategoryOrThrow(id);
  assertGlobalOrLocationAccess(user, category.locationId, 'delete');
  await category.deleteOne();
}

export async function updateInstamartCategoryStatus(id: string, status: string, user: JwtPayload) {
  return updateInstamartCategory(id, { status }, user);
}

// --- Subcategories ---

export async function listInstamartSubcategories(
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
    assertGlobalOrLocationAccess(user, category.locationId, 'view', category.status);
    mongoFilter.categoryId = filter.categoryId;
  } else {
    const accessibleCategoryIds = await InstamartCategory.find(instamartCategoryListFilter(user)).distinct('_id');
    mongoFilter.categoryId = { $in: accessibleCategoryIds };
  }

  const [items, total] = await Promise.all([
    InstamartSubcategory.find(mongoFilter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    InstamartSubcategory.countDocuments(mongoFilter),
  ]);
  return { items, total };
}

export async function createInstamartSubcategory(
  data: { categoryId: string; [key: string]: unknown },
  user: JwtPayload,
) {
  const category = await findCategoryOrThrow(data.categoryId);
  assertGlobalOrLocationAccess(user, category.locationId, 'edit');
  return InstamartSubcategory.create(data);
}

async function findSubcategoryOrThrow(id: string) {
  const subcategory = await InstamartSubcategory.findById(id);
  if (!subcategory) throw ApiError.notFound('Instamart subcategory not found', 'INSTAMART_SUBCATEGORY_NOT_FOUND');
  return subcategory;
}

export async function getInstamartSubcategoryById(id: string, user: JwtPayload) {
  const subcategory = await findSubcategoryOrThrow(id);
  const category = await findCategoryOrThrow(subcategory.categoryId.toString());
  assertGlobalOrLocationAccess(user, category.locationId, 'view', category.status);
  if (user.userType === 'CUSTOMER' && subcategory.status !== GENERIC_STATUS.ACTIVE) {
    throw ApiError.notFound('Instamart subcategory not found', 'INSTAMART_SUBCATEGORY_NOT_FOUND');
  }
  return subcategory;
}

export async function updateInstamartSubcategory(id: string, data: Record<string, unknown>, user: JwtPayload) {
  const subcategory = await findSubcategoryOrThrow(id);
  const category = await findCategoryOrThrow(subcategory.categoryId.toString());
  assertGlobalOrLocationAccess(user, category.locationId, 'edit');

  if (data.categoryId) {
    const newCategory = await findCategoryOrThrow(data.categoryId as string);
    assertGlobalOrLocationAccess(user, newCategory.locationId, 'edit');
  }

  Object.assign(subcategory, data);
  await subcategory.save();
  return subcategory;
}

export async function deleteInstamartSubcategory(id: string, user: JwtPayload) {
  const subcategory = await findSubcategoryOrThrow(id);
  const category = await findCategoryOrThrow(subcategory.categoryId.toString());
  assertGlobalOrLocationAccess(user, category.locationId, 'edit');
  await subcategory.deleteOne();
}

export async function updateInstamartSubcategoryStatus(id: string, status: string, user: JwtPayload) {
  return updateInstamartSubcategory(id, { status }, user);
}
