import { InstamartCategory } from '../models/InstamartCategory';
import { InstamartSubcategory } from '../models/InstamartSubcategory';
import { InstamartProduct } from '../models/InstamartProduct';
import { Location } from '../models/Location';
import { Store } from '../models/Store';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { assertLocationAccess, locationScopeFilter } from '../middleware/rbac.middleware';
import { ADMIN_ROLES } from '../constants/roles';
import { GENERIC_STATUS } from '../constants/enums';

// Shared, admin-managed taxonomy (a marketplace of independent stores needs
// one canonical "Fruits & Vegetables" that every store's products reference,
// not each store inventing its own — see the store-owned Product model
// instead for per-store data). CUSTOMER browses every location's ACTIVE
// catalog (no location scoping); a STORE additionally only sees categories
// relevant to its own storeTypeIds (a category with no storeTypeIds set is
// universal — visible to every store type); ADMIN follows ordinary location
// scoping, with global (locationId: null) categories always visible.
export async function instamartCategoryListFilter(user: JwtPayload): Promise<Record<string, unknown>> {
  if (user.userType === 'STORE') {
    const store = await Store.findById(user.userId).select('storeTypeIds');
    console.log("storestore",store)
    const storeTypeIds = store?.storeTypeIds ?? [];
    return {
      status: GENERIC_STATUS.ACTIVE,
      $or: [{ storeTypeIds: { $exists: false } }, { storeTypeIds: { $size: 0 } }, { storeTypeIds: { $in: storeTypeIds } }],
    };
  }
  if (user.userType === 'CUSTOMER') return { status: GENERIC_STATUS.ACTIVE };

  const scope = locationScopeFilter(user);
  if (!scope.locationId) return {};
  return { $or: [{ locationId: null }, scope] };
}

export async function listInstamartCategories(
  filter: Record<string, unknown>,
  pagination: PaginationParams,
  user: JwtPayload,
) {
  // Re-asserted here (not just in instamartCategoryListFilter) so an admin-only
  // query param merged in the controller (e.g. ?status=INACTIVE) can never leak
  // non-active categories to a customer/store.
  const query = user.userType === 'CUSTOMER' || user.userType === 'STORE' ? { ...filter, status: GENERIC_STATUS.ACTIVE } : filter;
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
  assertCategoryAccess(user, { locationId });
  return InstamartCategory.create(data);
}

async function findCategoryOrThrow(id: string) {
  const category = await InstamartCategory.findById(id);
  if (!category) throw ApiError.notFound('Instamart category not found', 'INSTAMART_CATEGORY_NOT_FOUND');
  return category;
}

// CUSTOMER/STORE may only read an ACTIVE category (a store assigns products
// into the shared taxonomy but does not manage it); ADMIN follows ordinary
// location scoping, except a global (locationId: null) category, which only
// a super admin may write.
function assertCategoryAccess(user: JwtPayload, category: { locationId?: unknown; status?: string }): void {
  if (user.userType === 'CUSTOMER' || user.userType === 'STORE') {
    if (category.status !== GENERIC_STATUS.ACTIVE) {
      throw ApiError.notFound('Instamart category not found', 'INSTAMART_CATEGORY_NOT_FOUND');
    }
    return;
  }

  if (category.locationId) {
    assertLocationAccess(user, (category.locationId as { toString(): string }).toString());
  } else if (user.role !== ADMIN_ROLES.SUPER_ADMIN) {
    throw ApiError.forbidden('Only a super admin can manage a global category', 'GLOBAL_CATEGORY_FORBIDDEN');
  }
}

export async function getInstamartCategoryById(id: string, user: JwtPayload) {
  const category = await findCategoryOrThrow(id);
  assertCategoryAccess(user, category);
  return category;
}

export async function updateInstamartCategory(id: string, data: Record<string, unknown>, user: JwtPayload) {
  const category = await findCategoryOrThrow(id);
  assertCategoryAccess(user, category);

  // Neither actor may reassign a category to a different location via update.
  delete data.locationId;

  Object.assign(category, data);
  await category.save();
  return category;
}

export async function deleteInstamartCategory(id: string, user: JwtPayload) {
  const category = await findCategoryOrThrow(id);
  assertCategoryAccess(user, category);
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
  // Re-asserted after the line above so a non-customer/store-only status
  // filter can never leak non-active subcategories to them.
  if (user.userType === 'CUSTOMER' || user.userType === 'STORE') mongoFilter.status = GENERIC_STATUS.ACTIVE;

  if (filter.categoryId) {
    const category = await findCategoryOrThrow(filter.categoryId);
    assertCategoryAccess(user, category);
    mongoFilter.categoryId = filter.categoryId;
  } else {
    const accessibleCategoryIds = await InstamartCategory.find(await instamartCategoryListFilter(user)).distinct('_id');
    mongoFilter.categoryId = { $in: accessibleCategoryIds };
  }

  const [items, total] = await Promise.all([
    InstamartSubcategory.find(mongoFilter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    InstamartSubcategory.countDocuments(mongoFilter),
  ]);
  return { items, total };
}

// A STORE may add its own subcategory under any category visible to it (same
// visibility rule as instamartCategoryListFilter: ACTIVE, and either
// universal or matching one of the store's own storeTypeIds) — it's
// instantly shared taxonomy, usable by every store, same as an admin-created
// one; only createdByStoreId distinguishes who added it (see
// assertSubcategoryWriteAccess below, which is what actually restricts
// edit/delete).
async function assertCategoryVisibleToStore(category: InstanceType<typeof InstamartCategory>, storeId: string): Promise<void> {
  if (category.status !== GENERIC_STATUS.ACTIVE) {
    throw ApiError.notFound('Instamart category not found', 'INSTAMART_CATEGORY_NOT_FOUND');
  }
  const store = await Store.findById(storeId).select('storeTypeIds');
  const storeTypeIds = (store?.storeTypeIds ?? []).map((id) => id.toString());
  const categoryTypeIds = category.storeTypeIds ?? [];
  const isUniversal = categoryTypeIds.length === 0;
  const matchesStoreType = categoryTypeIds.some((id) => storeTypeIds.includes(id.toString()));
  if (!isUniversal && !matchesStoreType) {
    throw ApiError.forbidden('This category is not relevant to your store type', 'CATEGORY_NOT_RELEVANT');
  }
}

export async function createInstamartSubcategory(
  data: { categoryId: string; [key: string]: unknown },
  user: JwtPayload,
) {
  const category = await findCategoryOrThrow(data.categoryId);

  if (user.userType === 'STORE') {
    await assertCategoryVisibleToStore(category, user.userId);
    return InstamartSubcategory.create({ ...data, createdByStoreId: user.userId });
  }

  assertCategoryAccess(user, category);
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
  assertCategoryAccess(user, category);
  if ((user.userType === 'CUSTOMER' || user.userType === 'STORE') && subcategory.status !== GENERIC_STATUS.ACTIVE) {
    throw ApiError.notFound('Instamart subcategory not found', 'INSTAMART_SUBCATEGORY_NOT_FOUND');
  }
  return subcategory;
}

// A STORE may only edit/delete a subcategory it created itself, and only
// while no OTHER store has a product listed under it yet — so one store can
// never rename/remove a subcategory another store already depends on. An
// ADMIN follows the ordinary category-based access check.
async function assertSubcategoryWriteAccess(
  subcategory: InstanceType<typeof InstamartSubcategory>,
  category: InstanceType<typeof InstamartCategory>,
  user: JwtPayload,
): Promise<void> {
  if (user.userType === 'STORE') {
    if (subcategory.createdByStoreId?.toString() !== user.userId) {
      throw ApiError.forbidden('You can only edit or delete a subcategory you created', 'SUBCATEGORY_NOT_OWNED');
    }
    const usedByOtherStore = await InstamartProduct.exists({
      subcategoryId: subcategory.id,
      storeId: { $ne: user.userId },
    });
    if (usedByOtherStore) {
      throw ApiError.badRequest('Another store already has products under this subcategory', 'SUBCATEGORY_IN_USE_BY_OTHER_STORE');
    }
    return;
  }
  assertCategoryAccess(user, category);
}

export async function updateInstamartSubcategory(id: string, data: Record<string, unknown>, user: JwtPayload) {
  const subcategory = await findSubcategoryOrThrow(id);
  const category = await findCategoryOrThrow(subcategory.categoryId.toString());
  await assertSubcategoryWriteAccess(subcategory, category, user);

  // A store's subcategory stays attached to the category it was created
  // under — only an admin may reassign it to a different category.
  if (user.userType === 'STORE') {
    delete data.categoryId;
  } else if (data.categoryId) {
    const newCategory = await findCategoryOrThrow(data.categoryId as string);
    assertCategoryAccess(user, newCategory);
  }

  Object.assign(subcategory, data);
  await subcategory.save();
  return subcategory;
}

export async function deleteInstamartSubcategory(id: string, user: JwtPayload) {
  const subcategory = await findSubcategoryOrThrow(id);
  const category = await findCategoryOrThrow(subcategory.categoryId.toString());
  await assertSubcategoryWriteAccess(subcategory, category, user);
  await subcategory.deleteOne();
}

export async function updateInstamartSubcategoryStatus(id: string, status: string, user: JwtPayload) {
  return updateInstamartSubcategory(id, { status }, user);
}
