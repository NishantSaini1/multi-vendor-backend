import { InstamartGlobalProduct } from '../models/InstamartGlobalProduct';
import { InstamartProduct } from '../models/InstamartProduct';
import { InstamartCategory } from '../models/InstamartCategory';
import { InstamartSubcategory } from '../models/InstamartSubcategory';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { APPROVAL_STATUS, GENERIC_STATUS } from '../constants/enums';

export async function assertCategoryAndSubcategory(categoryId: string, subcategoryId?: string): Promise<void> {
  const category = await InstamartCategory.exists({ _id: categoryId });
  if (!category) throw ApiError.notFound('Instamart category not found', 'INSTAMART_CATEGORY_NOT_FOUND');

  if (subcategoryId) {
    const subcategory = await InstamartSubcategory.findById(subcategoryId);
    if (!subcategory) throw ApiError.notFound('Instamart subcategory not found', 'INSTAMART_SUBCATEGORY_NOT_FOUND');
    if (subcategory.categoryId.toString() !== categoryId) {
      throw ApiError.badRequest('subcategory does not belong to the given category', 'SUBCATEGORY_CATEGORY_MISMATCH');
    }
  }
}

// A STORE actor may only browse APPROVED + ACTIVE products (to pick one to
// list against, Option A of product creation) — never another store's
// PENDING submission. ADMIN sees everything, including PENDING ones awaiting
// review.
export function instamartGlobalProductListFilter(user: JwtPayload): Record<string, unknown> {
  if (user.userType === 'STORE' || user.userType === 'CUSTOMER') {
    return { approvalStatus: APPROVAL_STATUS.APPROVED, status: GENERIC_STATUS.ACTIVE };
  }
  return {};
}

export async function listInstamartGlobalProducts(
  filter: Record<string, unknown>,
  pagination: PaginationParams,
  user: JwtPayload,
) {
  // Re-asserted here so an admin-only ?approvalStatus=/?status= query param
  // merged in the controller can never leak a PENDING/INACTIVE product to a
  // store or customer.
  const query =
    user.userType === 'STORE' || user.userType === 'CUSTOMER'
      ? { ...filter, approvalStatus: APPROVAL_STATUS.APPROVED, status: GENERIC_STATUS.ACTIVE }
      : filter;
  const [items, total] = await Promise.all([
    InstamartGlobalProduct.find(query).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    InstamartGlobalProduct.countDocuments(query),
  ]);
  return { items, total };
}

export async function createInstamartGlobalProduct(data: Record<string, unknown>, user: JwtPayload) {
  void user;
  await assertCategoryAndSubcategory(data.categoryId as string, data.subcategoryId as string | undefined);
  return InstamartGlobalProduct.create({ ...data, approvalStatus: APPROVAL_STATUS.APPROVED });
}

async function findGlobalProductOrThrow(id: string) {
  const product = await InstamartGlobalProduct.findById(id);
  if (!product) throw ApiError.notFound('Instamart global product not found', 'INSTAMART_GLOBAL_PRODUCT_NOT_FOUND');
  return product;
}

function isOwnSubmission(product: { submittedByStoreId?: { toString(): string } }, user: JwtPayload): boolean {
  return user.userType === 'STORE' && product.submittedByStoreId?.toString() === user.userId;
}

export async function getInstamartGlobalProductById(id: string, user: JwtPayload) {
  const product = await findGlobalProductOrThrow(id);
  if ((user.userType === 'STORE' || user.userType === 'CUSTOMER') && !isOwnSubmission(product, user)) {
    if (product.approvalStatus !== APPROVAL_STATUS.APPROVED || product.status !== GENERIC_STATUS.ACTIVE) {
      throw ApiError.notFound('Instamart global product not found', 'INSTAMART_GLOBAL_PRODUCT_NOT_FOUND');
    }
  }
  return product;
}

// A STORE may edit a product it submitted itself (e.g. fix the image/name/
// MRP it entered) — but only while no OTHER store has a mapping onto it yet
// (same "no effect on other store" guarantee as subcategory ownership; see
// instamartCategory.service.ts's assertSubcategoryWriteAccess). Once another
// store lists the same product, it becomes shared and only an admin may
// edit it further.
export async function updateInstamartGlobalProduct(id: string, data: Record<string, unknown>, user: JwtPayload) {
  const product = await findGlobalProductOrThrow(id);

  if (user.userType === 'STORE') {
    if (!isOwnSubmission(product, user)) {
      throw ApiError.forbidden('You can only edit a product you submitted', 'GLOBAL_PRODUCT_NOT_OWNED');
    }
    const usedByOtherStore = await InstamartProduct.exists({ productId: id, storeId: { $ne: user.userId } });
    if (usedByOtherStore) {
      throw ApiError.badRequest('Another store already lists this product', 'GLOBAL_PRODUCT_IN_USE_BY_OTHER_STORE');
    }
  }

  const categoryId = (data.categoryId as string | undefined) ?? product.categoryId.toString();
  const subcategoryId = (data.subcategoryId as string | undefined) ?? product.subcategoryId?.toString();
  if (data.categoryId || data.subcategoryId) {
    await assertCategoryAndSubcategory(categoryId, subcategoryId);
  }

  Object.assign(product, data);
  await product.save();
  return product;
}

export async function deleteInstamartGlobalProduct(id: string) {
  const product = await findGlobalProductOrThrow(id);
  const inUse = await InstamartProduct.exists({ productId: id });
  if (inUse) {
    throw ApiError.badRequest('This product is listed by at least one store and cannot be deleted', 'GLOBAL_PRODUCT_IN_USE');
  }
  await product.deleteOne();
}

export async function updateInstamartGlobalProductStatus(id: string, status: string, user: JwtPayload) {
  return updateInstamartGlobalProduct(id, { status }, user);
}

// Mirrors vendor.service/store.service's approve/reject pattern for the
// store-submitted "propose a new product" flow (Option B of product
// creation) — approving here is what makes the product (and every store
// mapping already pointing at it) visible to customers.
export async function approveInstamartGlobalProduct(id: string, user: JwtPayload) {
  void user;
  const product = await findGlobalProductOrThrow(id);
  if (product.approvalStatus !== APPROVAL_STATUS.PENDING) {
    throw ApiError.badRequest('Only a pending product can be approved', 'GLOBAL_PRODUCT_NOT_PENDING');
  }
  product.approvalStatus = APPROVAL_STATUS.APPROVED;
  product.rejectionReason = undefined;
  await product.save();
  return product;
}

export async function rejectInstamartGlobalProduct(id: string, reason: string, user: JwtPayload) {
  void user;
  const product = await findGlobalProductOrThrow(id);
  if (product.approvalStatus !== APPROVAL_STATUS.PENDING) {
    throw ApiError.badRequest('Only a pending product can be rejected', 'GLOBAL_PRODUCT_NOT_PENDING');
  }
  product.approvalStatus = APPROVAL_STATUS.REJECTED;
  product.rejectionReason = reason;
  await product.save();
  return product;
}
