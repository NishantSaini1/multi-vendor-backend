import { FoodProduct } from '../models/FoodProduct';
import { FoodCategory } from '../models/FoodCategory';
import { FoodSubcategory } from '../models/FoodSubcategory';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { GLOBAL_FOOD_ITEM_STATUS } from '../constants/enums';

// The GLOBAL Food Item catalog (FoodProduct) — one canonical "Paneer Butter
// Masala" every vendor's own VendorFoodItem listing maps onto (see
// vendorFoodItem.service.ts), mirroring InstamartGlobalProduct. Admin manages
// it directly here; a vendor's "this doesn't exist yet" proposal goes through
// FoodItemSubmission instead (see foodItemSubmission.service.ts) and only
// becomes a FoodProduct once approved.
async function assertCategoryAndSubcategory(categoryId: string, subcategoryId?: string | null): Promise<void> {
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

// CUSTOMER/VENDOR browsing the catalog (to pick an existing item to list, or
// to browse a restaurant's menu) only ever see ACTIVE items; ADMIN sees every
// status, including PENDING_APPROVAL/REJECTED ones awaiting review.
export function foodProductListFilter(user: JwtPayload): Record<string, unknown> {
  if (user.userType === 'CUSTOMER' || user.userType === 'VENDOR') return { status: GLOBAL_FOOD_ITEM_STATUS.ACTIVE };
  return {};
}

export async function listFoodProducts(
  filter: Record<string, unknown>,
  pagination: PaginationParams,
  user: JwtPayload,
) {
  // Re-asserted here (not just in foodProductListFilter) so an admin-only
  // query param merged in the controller (e.g. ?status=PENDING_APPROVAL) can
  // never leak a non-active item to a customer/vendor.
  const query =
    user.userType === 'CUSTOMER' || user.userType === 'VENDOR' ? { ...filter, status: GLOBAL_FOOD_ITEM_STATUS.ACTIVE } : filter;
  const [items, total] = await Promise.all([
    FoodProduct.find(query).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    FoodProduct.countDocuments(query),
  ]);
  return { items, total };
}

// Admin-only (enforced at the route level) — creates an item directly as
// ACTIVE with no submittedByVendorId, unlike the vendor-submission path.
export async function createFoodProduct(data: Record<string, unknown>) {
  await assertCategoryAndSubcategory(data.categoryId as string, data.subcategoryId as string | undefined);
  return FoodProduct.create({ ...data, submittedByVendorId: null, status: GLOBAL_FOOD_ITEM_STATUS.ACTIVE });
}

// Exported for reuse by vendorFoodItem.service.ts and foodItemSubmission.service.ts.
export async function findFoodProductOrThrow(id: string) {
  const product = await FoodProduct.findById(id);
  if (!product) throw ApiError.notFound('Food item not found', 'FOOD_PRODUCT_NOT_FOUND');
  return product;
}

export async function getFoodProductById(id: string, user: JwtPayload) {
  const product = await findFoodProductOrThrow(id);
  if ((user.userType === 'CUSTOMER' || user.userType === 'VENDOR') && product.status !== GLOBAL_FOOD_ITEM_STATUS.ACTIVE) {
    throw ApiError.notFound('Food item not found', 'FOOD_PRODUCT_NOT_FOUND');
  }
  return product;
}

export async function updateFoodProduct(id: string, data: Record<string, unknown>) {
  const product = await findFoodProductOrThrow(id);

  const categoryId = (data.categoryId as string | undefined) ?? product.categoryId.toString();
  const subcategoryId = (data.subcategoryId as string | undefined) ?? product.subcategoryId?.toString();
  if (data.categoryId || data.subcategoryId) {
    await assertCategoryAndSubcategory(categoryId, subcategoryId);
  }

  // Never reassignable via a plain update — set only by the submission
  // approval flow (see foodItemSubmission.service.ts).
  delete data.submittedByVendorId;

  Object.assign(product, data);
  await product.save();
  return product;
}

export async function deleteFoodProduct(id: string) {
  const product = await findFoodProductOrThrow(id);
  await product.deleteOne();
}

export async function updateFoodProductStatus(id: string, status: string) {
  return updateFoodProduct(id, { status });
}
