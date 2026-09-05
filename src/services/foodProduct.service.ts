import { FoodProduct } from '../models/FoodProduct';
import { FoodVariant } from '../models/FoodVariant';
import { FoodCategory } from '../models/FoodCategory';
import { FoodSubcategory } from '../models/FoodSubcategory';
import { Vendor } from '../models/Vendor';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { assertOwnerOrLocationAccess, locationScopeFilter } from '../middleware/rbac.middleware';

async function resolveVendorAndLocation(
  data: { vendorId?: string; locationId?: string },
  user: JwtPayload,
): Promise<{ vendorId: string; locationId: string }> {
  if (user.userType === 'VENDOR') {
    const vendor = await Vendor.findById(user.userId);
    if (!vendor) throw ApiError.notFound('Vendor not found', 'VENDOR_NOT_FOUND');
    return { vendorId: vendor.id, locationId: vendor.locationId.toString() };
  }

  if (!data.vendorId) throw ApiError.badRequest('vendorId is required', 'VENDOR_ID_REQUIRED');
  const vendor = await Vendor.findById(data.vendorId);
  if (!vendor) throw ApiError.notFound('Vendor not found', 'VENDOR_NOT_FOUND');

  const locationId = vendor.locationId.toString();
  if (data.locationId && data.locationId !== locationId) {
    throw ApiError.badRequest('locationId must match the vendor\'s location', 'LOCATION_VENDOR_MISMATCH');
  }
  assertOwnerOrLocationAccess(user, vendor.id, locationId);
  return { vendorId: vendor.id, locationId };
}

async function assertCategoryAndSubcategory(categoryId: string, subcategoryId?: string): Promise<void> {
  const category = await FoodCategory.exists({ _id: categoryId });
  if (!category) throw ApiError.notFound('Food category not found', 'FOOD_CATEGORY_NOT_FOUND');

  if (subcategoryId) {
    const subcategory = await FoodSubcategory.findById(subcategoryId);
    if (!subcategory) throw ApiError.notFound('Food subcategory not found', 'FOOD_SUBCATEGORY_NOT_FOUND');
    if (subcategory.categoryId.toString() !== categoryId) {
      throw ApiError.badRequest('subcategory does not belong to the given category', 'SUBCATEGORY_CATEGORY_MISMATCH');
    }
  }
}

export function foodProductListFilter(user: JwtPayload): Record<string, unknown> {
  if (user.userType === 'VENDOR') return { vendorId: user.userId };
  return locationScopeFilter(user);
}

export async function listFoodProducts(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total] = await Promise.all([
    FoodProduct.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    FoodProduct.countDocuments(filter),
  ]);
  return { items, total };
}

export async function createFoodProduct(data: Record<string, unknown>, user: JwtPayload) {
  const { vendorId, locationId } = await resolveVendorAndLocation(
    { vendorId: data.vendorId as string | undefined, locationId: data.locationId as string | undefined },
    user,
  );
  await assertCategoryAndSubcategory(data.categoryId as string, data.subcategoryId as string | undefined);

  return FoodProduct.create({ ...data, vendorId, locationId });
}

async function findProductOrThrow(id: string) {
  const product = await FoodProduct.findById(id);
  if (!product) throw ApiError.notFound('Food product not found', 'FOOD_PRODUCT_NOT_FOUND');
  return product;
}

export async function getFoodProductById(id: string, user: JwtPayload) {
  const product = await findProductOrThrow(id);
  assertOwnerOrLocationAccess(user, product.vendorId.toString(), product.locationId.toString());
  return product;
}

export async function updateFoodProduct(id: string, data: Record<string, unknown>, user: JwtPayload) {
  const product = await findProductOrThrow(id);
  assertOwnerOrLocationAccess(user, product.vendorId.toString(), product.locationId.toString());

  const categoryId = (data.categoryId as string | undefined) ?? product.categoryId.toString();
  const subcategoryId = (data.subcategoryId as string | undefined) ?? product.subcategoryId?.toString();
  if (data.categoryId || data.subcategoryId) {
    await assertCategoryAndSubcategory(categoryId, subcategoryId);
  }

  // Neither actor may reassign a product to a different vendor/location via update.
  delete data.vendorId;
  delete data.locationId;

  Object.assign(product, data);
  await product.save();
  return product;
}

export async function deleteFoodProduct(id: string, user: JwtPayload) {
  const product = await findProductOrThrow(id);
  assertOwnerOrLocationAccess(user, product.vendorId.toString(), product.locationId.toString());
  await FoodVariant.deleteMany({ productId: id });
  await product.deleteOne();
}

export async function updateFoodProductStatus(id: string, status: string, user: JwtPayload) {
  return updateFoodProduct(id, { status }, user);
}

export async function updateFoodProductAvailability(id: string, isAvailable: boolean, user: JwtPayload) {
  return updateFoodProduct(id, { isAvailable }, user);
}

// --- Variants ---

export async function listFoodVariants(productId: string, user: JwtPayload) {
  const product = await findProductOrThrow(productId);
  assertOwnerOrLocationAccess(user, product.vendorId.toString(), product.locationId.toString());
  return FoodVariant.find({ productId }).sort({ isDefault: -1, name: 1 });
}

export async function createFoodVariant(productId: string, data: Record<string, unknown>, user: JwtPayload) {
  const product = await findProductOrThrow(productId);
  assertOwnerOrLocationAccess(user, product.vendorId.toString(), product.locationId.toString());
  return FoodVariant.create({ ...data, productId });
}

export async function updateFoodVariant(
  productId: string,
  variantId: string,
  data: Record<string, unknown>,
  user: JwtPayload,
) {
  const product = await findProductOrThrow(productId);
  assertOwnerOrLocationAccess(user, product.vendorId.toString(), product.locationId.toString());

  const variant = await FoodVariant.findOneAndUpdate({ _id: variantId, productId }, data, { new: true });
  if (!variant) throw ApiError.notFound('Food variant not found', 'FOOD_VARIANT_NOT_FOUND');
  return variant;
}

export async function deleteFoodVariant(productId: string, variantId: string, user: JwtPayload) {
  const product = await findProductOrThrow(productId);
  assertOwnerOrLocationAccess(user, product.vendorId.toString(), product.locationId.toString());

  const variant = await FoodVariant.findOneAndDelete({ _id: variantId, productId });
  if (!variant) throw ApiError.notFound('Food variant not found', 'FOOD_VARIANT_NOT_FOUND');
}
