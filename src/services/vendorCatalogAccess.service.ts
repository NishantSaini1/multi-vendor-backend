import { VendorCatalogAccess } from '../models/VendorCatalogAccess';
import { FoodCategory } from '../models/FoodCategory';
import { FoodSubcategory } from '../models/FoodSubcategory';
import { Vendor } from '../models/Vendor';
import { ApiError } from '../utils/ApiError';
import { JwtPayload } from '../utils/jwt';
import { assertOwnerOrLocationAccess } from '../middleware/rbac.middleware';

async function findVendorOrThrow(vendorId: string) {
  const vendor = await Vendor.findById(vendorId);
  if (!vendor) throw ApiError.notFound('Vendor not found', 'VENDOR_NOT_FOUND');
  return vendor;
}

// Same "subcategory must belong to the given category" check foodProduct.service.ts
// uses for FoodProduct.categoryId/subcategoryId. Exported for reuse by
// foodItemSubmission.service.ts.
export async function assertCategoryAndSubcategoryExist(categoryId: string, subcategoryId?: string | null): Promise<void> {
  const category = await FoodCategory.exists({ _id: categoryId });
  if (!category) throw ApiError.notFound('Food category not found', 'FOOD_CATEGORY_NOT_FOUND');

  if (subcategoryId) {
    const subcategory = await FoodSubcategory.findById(subcategoryId);
    if (!subcategory) throw ApiError.notFound('Food subcategory not found', 'FOOD_SUBCATEGORY_NOT_FOUND');
    if (subcategory.categoryId.toString() !== categoryId) {
      throw ApiError.badRequest('Subcategory does not belong to the given category', 'SUBCATEGORY_CATEGORY_MISMATCH');
    }
  }
}

// Admin, or the vendor themself (e.g. Vendor App showing "what admin has
// granted me so far" before falling back to /vendors/me/catalog-access).
export async function listVendorCatalogAccess(vendorId: string, user: JwtPayload) {
  const vendor = await findVendorOrThrow(vendorId);
  assertOwnerOrLocationAccess(user, vendor.id, vendor.locationId.toString());
  return VendorCatalogAccess.find({ vendorId }).sort({ createdAt: -1 });
}

// The vendor-facing "what can I add" picker — a logged-in vendor listing
// their own grants, with no vendorId route param needed.
export async function listMyVendorCatalogAccess(user: JwtPayload) {
  return VendorCatalogAccess.find({ vendorId: user.userId }).sort({ createdAt: -1 });
}

// Admin-only (enforced at the route level): grants a vendor access to a
// category, or to one specific subcategory within it when subcategoryId is
// given (null/omitted grants the whole category).
export async function grantVendorCatalogAccess(vendorId: string, data: { categoryId: string; subcategoryId?: string | null }) {
  await findVendorOrThrow(vendorId);
  await assertCategoryAndSubcategoryExist(data.categoryId, data.subcategoryId ?? null);

  try {
    return await VendorCatalogAccess.create({
      vendorId,
      categoryId: data.categoryId,
      subcategoryId: data.subcategoryId ?? null,
    });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code?: number }).code === 11000) {
      throw ApiError.conflict('This vendor already has this exact category/subcategory access grant', 'CATALOG_ACCESS_ALREADY_GRANTED');
    }
    throw err;
  }
}

// Admin-only (enforced at the route level): revokes a single grant.
export async function revokeVendorCatalogAccess(vendorId: string, accessId: string) {
  const access = await VendorCatalogAccess.findOneAndDelete({ _id: accessId, vendorId });
  if (!access) throw ApiError.notFound('Vendor catalog access grant not found', 'VENDOR_CATALOG_ACCESS_NOT_FOUND');
}

// Shared by vendorFoodItem.service.ts ("add existing item") and
// foodItemSubmission.service.ts (a vendor proposing a new one) — a vendor may
// only touch a category/subcategory it's been explicitly granted. A grant
// with subcategoryId: null covers the whole category (any subcategory, or
// none); a subcategory-scoped grant covers only that exact subcategory, so an
// item with no subcategoryId of its own can only be covered by a
// whole-category grant.
export async function assertVendorHasCatalogAccess(
  vendorId: string,
  categoryId: string,
  subcategoryId?: string | null,
): Promise<void> {
  const query: Record<string, unknown> = { vendorId, categoryId };
  query.$or = subcategoryId ? [{ subcategoryId: null }, { subcategoryId }] : [{ subcategoryId: null }];

  const grant = await VendorCatalogAccess.exists(query);
  if (!grant) {
    throw ApiError.forbidden(
      'You do not have catalog access to this category/subcategory — ask an admin to grant it first',
      'CATALOG_ACCESS_FORBIDDEN',
    );
  }
}
