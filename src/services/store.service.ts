import { Store } from '../models/Store';
import { StoreDocument } from '../models/StoreDocument';
import { InstamartProduct } from '../models/InstamartProduct';
import { Inventory } from '../models/Inventory';
import { Location } from '../models/Location';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { assertLocationAccess } from '../middleware/rbac.middleware';

export async function listStores(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total] = await Promise.all([
    Store.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    Store.countDocuments(filter),
  ]);
  return { items, total };
}

export async function createStore(data: Record<string, unknown>) {
  const locationExists = await Location.exists({ _id: data.locationId });
  if (!locationExists) throw ApiError.notFound('Location not found', 'LOCATION_NOT_FOUND');
  return Store.create(data);
}

async function findStoreOrThrow(id: string) {
  const store = await Store.findById(id);
  if (!store) throw ApiError.notFound('Store not found', 'STORE_NOT_FOUND');
  return store;
}

export async function getStoreById(id: string, user: JwtPayload) {
  const store = await findStoreOrThrow(id);
  assertLocationAccess(user, store.locationId.toString());
  return store;
}

export async function updateStore(id: string, data: Record<string, unknown>, user: JwtPayload) {
  const store = await findStoreOrThrow(id);
  assertLocationAccess(user, store.locationId.toString());
  Object.assign(store, data);
  await store.save();
  return store;
}

export async function deleteStore(id: string, user: JwtPayload) {
  const store = await findStoreOrThrow(id);
  assertLocationAccess(user, store.locationId.toString());
  await store.deleteOne();
}

export async function updateStoreStatus(id: string, status: string, user: JwtPayload) {
  return updateStore(id, { status }, user);
}

export async function getStoreDashboard(id: string, user: JwtPayload) {
  const store = await findStoreOrThrow(id);
  assertLocationAccess(user, store.locationId.toString());

  const [productCount, lowStockCount, outOfStockCount] = await Promise.all([
    InstamartProduct.countDocuments({ storeId: id }),
    Inventory.countDocuments({ storeId: id, $expr: { $lte: [{ $subtract: ['$currentStock', '$reservedStock'] }, '$minimumStock'] } }),
    Inventory.countDocuments({ storeId: id, $expr: { $lte: [{ $subtract: ['$currentStock', '$reservedStock'] }, 0] } }),
  ]);

  return {
    productCount,
    lowStockCount,
    outOfStockCount,
    rating: store.rating,
    ratingCount: store.ratingCount,
    status: store.status,
  };
}

export async function getStoreProducts(id: string, user: JwtPayload, pagination: PaginationParams) {
  const store = await findStoreOrThrow(id);
  assertLocationAccess(user, store.locationId.toString());

  const [items, total] = await Promise.all([
    InstamartProduct.find({ storeId: id }).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    InstamartProduct.countDocuments({ storeId: id }),
  ]);
  return { items, total };
}

export async function getStoreInventory(id: string, user: JwtPayload, pagination: PaginationParams) {
  const store = await findStoreOrThrow(id);
  assertLocationAccess(user, store.locationId.toString());

  const [items, total] = await Promise.all([
    Inventory.find({ storeId: id }).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    Inventory.countDocuments({ storeId: id }),
  ]);
  return { items, total };
}

export async function listStoreDocuments(storeId: string, user: JwtPayload) {
  const store = await findStoreOrThrow(storeId);
  assertLocationAccess(user, store.locationId.toString());
  return StoreDocument.find({ storeId }).sort({ createdAt: -1 });
}

export async function addStoreDocument(storeId: string, data: Record<string, unknown>, user: JwtPayload) {
  const store = await findStoreOrThrow(storeId);
  assertLocationAccess(user, store.locationId.toString());
  return StoreDocument.create({ ...data, storeId });
}

export async function updateStoreDocument(
  storeId: string,
  documentId: string,
  data: Record<string, unknown>,
  user: JwtPayload,
) {
  const store = await findStoreOrThrow(storeId);
  assertLocationAccess(user, store.locationId.toString());

  const document = await StoreDocument.findOneAndUpdate({ _id: documentId, storeId }, data, { new: true });
  if (!document) throw ApiError.notFound('Store document not found', 'STORE_DOCUMENT_NOT_FOUND');
  return document;
}

export async function deleteStoreDocument(storeId: string, documentId: string, user: JwtPayload) {
  const store = await findStoreOrThrow(storeId);
  assertLocationAccess(user, store.locationId.toString());

  const document = await StoreDocument.findOneAndDelete({ _id: documentId, storeId });
  if (!document) throw ApiError.notFound('Store document not found', 'STORE_DOCUMENT_NOT_FOUND');
}
