import mongoose from 'mongoose';
import { InstamartProduct } from '../models/InstamartProduct';
import { InstamartCategory } from '../models/InstamartCategory';
import { InstamartSubcategory } from '../models/InstamartSubcategory';
import { Inventory } from '../models/Inventory';
import { Store } from '../models/Store';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { assertLocationAccess, locationScopeFilter } from '../middleware/rbac.middleware';

async function assertCategoryAndSubcategory(categoryId: string, subcategoryId?: string): Promise<void> {
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

export function instamartProductListFilter(user: JwtPayload): Record<string, unknown> {
  return locationScopeFilter(user);
}

export async function listInstamartProducts(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total] = await Promise.all([
    InstamartProduct.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    InstamartProduct.countDocuments(filter),
  ]);
  return { items, total };
}

export async function createInstamartProduct(data: Record<string, unknown>, user: JwtPayload) {
  const store = await Store.findById(data.storeId as string);
  if (!store) throw ApiError.notFound('Store not found', 'STORE_NOT_FOUND');
  assertLocationAccess(user, store.locationId.toString());

  await assertCategoryAndSubcategory(data.categoryId as string, data.subcategoryId as string | undefined);

  const session = await mongoose.startSession();
  try {
    let product: InstanceType<typeof InstamartProduct> | undefined;
    await session.withTransaction(async () => {
      const [created] = await InstamartProduct.create(
        [{ ...data, locationId: store.locationId }],
        { session },
      );
      product = created;
      await Inventory.create(
        [
          {
            locationId: store.locationId,
            storeId: store.id,
            productId: created.id,
            currentStock: 0,
            reservedStock: 0,
          },
        ],
        { session },
      );
    });
    return product!;
  } finally {
    await session.endSession();
  }
}

async function findProductOrThrow(id: string) {
  const product = await InstamartProduct.findById(id);
  if (!product) throw ApiError.notFound('Instamart product not found', 'INSTAMART_PRODUCT_NOT_FOUND');
  return product;
}

export async function getInstamartProductById(id: string, user: JwtPayload) {
  const product = await findProductOrThrow(id);
  assertLocationAccess(user, product.locationId.toString());
  return product;
}

export async function updateInstamartProduct(id: string, data: Record<string, unknown>, user: JwtPayload) {
  const product = await findProductOrThrow(id);
  assertLocationAccess(user, product.locationId.toString());

  const categoryId = (data.categoryId as string | undefined) ?? product.categoryId.toString();
  const subcategoryId = (data.subcategoryId as string | undefined) ?? product.subcategoryId?.toString();
  if (data.categoryId || data.subcategoryId) {
    await assertCategoryAndSubcategory(categoryId, subcategoryId);
  }

  delete data.locationId;
  Object.assign(product, data);
  await product.save();
  return product;
}

export async function deleteInstamartProduct(id: string, user: JwtPayload) {
  const product = await findProductOrThrow(id);
  assertLocationAccess(user, product.locationId.toString());

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Inventory.deleteMany({ productId: id }, { session });
      await product.deleteOne({ session });
    });
  } finally {
    await session.endSession();
  }
}

export async function updateInstamartProductStatus(id: string, status: string, user: JwtPayload) {
  return updateInstamartProduct(id, { status }, user);
}
