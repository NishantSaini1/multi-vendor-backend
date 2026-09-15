import { Store } from '../models/Store';
import { StoreDocument } from '../models/StoreDocument';
import { InstamartProduct } from '../models/InstamartProduct';
import { IInstamartGlobalProduct } from '../models/InstamartGlobalProduct';
import { withGlobalProducts, globalProductVisible } from './instamartProduct.service';
import { Inventory } from '../models/Inventory';
import { Location } from '../models/Location';
import { ApiError } from '../utils/ApiError';
import { hashPassword } from '../utils/password';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { assertLocationAccess, assertOwnerOrLocationAccess } from '../middleware/rbac.middleware';
import { findMatchingZone } from './deliveryZone.service';
import { StoreType } from '../models/StoreType';
import { STORE_APPROVAL_STATUS, STORE_STATUS, GENERIC_STATUS } from '../constants/enums';

export async function listStores(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total] = await Promise.all([
    Store.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    Store.countDocuments(filter),
  ]);
  return { items, total };
}

// Location -> Zone -> Store: a store's zone is derived from its own
// coordinates (same lat/long already required for the store itself), never
// chosen manually, mirroring how a customer's zone is resolved in
// serviceability.service.ts.
async function resolveZoneForStore(locationId: string, latitude: number, longitude: number) {
  const zone = await findMatchingZone(locationId, latitude, longitude);
  if (!zone) {
    throw ApiError.badRequest(
      'No delivery zone covers this location/coordinates yet — add one before creating a store here',
      'NO_DELIVERY_ZONE_CONFIGURED',
    );
  }
  return zone;
}

async function assertStoreTypesExist(storeTypeIds: string[]): Promise<void> {
  const count = await StoreType.countDocuments({ _id: { $in: storeTypeIds } });
  if (count !== new Set(storeTypeIds).size) throw ApiError.notFound('Store type not found', 'STORE_TYPE_NOT_FOUND');
}

// A store may carry several types (e.g. a Supermarket = Grocery + Bakery &
// Dairy); the "one store per type per zone" rule applies per individual
// type, so this checks the whole array for any overlap with an existing
// store's types in the same zone (mirroring the DB's multikey unique index).
async function assertNoStoreTypeOverlapInZone(deliveryZoneId: string, storeTypeIds: string[], excludeStoreId?: string): Promise<void> {
  const filter: Record<string, unknown> = { deliveryZoneId, storeTypeIds: { $in: storeTypeIds } };
  if (excludeStoreId) filter._id = { $ne: excludeStoreId };
  const exists = await Store.exists(filter);
  if (exists) {
    throw ApiError.conflict('A store with one of these types already exists in this zone', 'STORE_TYPE_ALREADY_EXISTS_IN_ZONE');
  }
}

export async function createStore(data: Record<string, unknown>) {
  const locationExists = await Location.exists({ _id: data.locationId });
  if (!locationExists) throw ApiError.notFound('Location not found', 'LOCATION_NOT_FOUND');

  const storeTypeIds = data.storeTypeIds as string[];
  await assertStoreTypesExist(storeTypeIds);
  const zone = await resolveZoneForStore(data.locationId as string, data.latitude as number, data.longitude as number);
  await assertNoStoreTypeOverlapInZone(zone.id, storeTypeIds);

  const password = await hashPassword(data.password as string);
  return Store.create({
    ...data,
    password,
    deliveryZoneId: zone.id,
    status: STORE_STATUS.ACTIVE,
    approvalStatus: STORE_APPROVAL_STATUS.PENDING,
  });
}

async function findStoreOrThrow(id: string) {
  const store = await Store.findById(id);
  if (!store) throw ApiError.notFound('Store not found', 'STORE_NOT_FOUND');
  return store;
}

// A store is its own owner (there's no separate storeId field to compare
// against — the store's own JWT userId is its _id), so this reuses the
// ownerId/locationId helper the same way Vendor's product ownership does.
function assertStoreAccess(user: JwtPayload, store: { _id: { toString(): string }; locationId: { toString(): string } }): void {
  assertOwnerOrLocationAccess(user, store._id.toString(), store.locationId.toString());
}

export async function getStoreById(id: string, user: JwtPayload) {
  const store = await findStoreOrThrow(id);
  assertStoreAccess(user, store);
  return store;
}

export async function updateStore(id: string, data: Record<string, unknown>, user: JwtPayload) {
  const store = await findStoreOrThrow(id);
  assertStoreAccess(user, store);

  // Neither actor may reassign a store to a different location via update;
  // deliveryZoneId is always derived, never client-set (see createStore).
  delete data.locationId;
  delete data.deliveryZoneId;

  let resolvedZoneId = store.deliveryZoneId.toString();
  if (data.latitude !== undefined || data.longitude !== undefined) {
    const latitude = (data.latitude as number | undefined) ?? store.latitude;
    const longitude = (data.longitude as number | undefined) ?? store.longitude;
    const zone = await resolveZoneForStore(store.locationId.toString(), latitude, longitude);
    resolvedZoneId = zone.id;
    data.deliveryZoneId = zone.id;
  }

  if (data.storeTypeIds !== undefined) await assertStoreTypesExist(data.storeTypeIds as string[]);

  const finalStoreTypeIds = (data.storeTypeIds as string[] | undefined) ?? store.storeTypeIds.map((id) => id.toString());
  if (data.storeTypeIds !== undefined || resolvedZoneId !== store.deliveryZoneId.toString()) {
    await assertNoStoreTypeOverlapInZone(resolvedZoneId, finalStoreTypeIds, store.id);
  }

  // The model has no pre-save hashing hook (see createStore, which hashes
  // explicitly) — a plaintext password assigned directly here would silently
  // break login (bcrypt.compare against an unhashed value never matches).
  if (data.password) {
    data.password = await hashPassword(data.password as string);
  } else {
    delete data.password;
  }

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

export async function approveStore(id: string, user: JwtPayload) {
  const store = await findStoreOrThrow(id);
  assertLocationAccess(user, store.locationId.toString());
  store.approvalStatus = STORE_APPROVAL_STATUS.APPROVED;
  store.status = STORE_STATUS.ACTIVE;
  await store.save();
  return store;
}

export async function rejectStore(id: string, reason: string, user: JwtPayload) {
  const store = await findStoreOrThrow(id);
  assertLocationAccess(user, store.locationId.toString());
  store.approvalStatus = STORE_APPROVAL_STATUS.REJECTED;
  store.status = STORE_STATUS.INACTIVE;
  await store.save();
  return { store, reason };
}

export async function getStoreDashboard(id: string, user: JwtPayload) {
  const store = await findStoreOrThrow(id);
  assertStoreAccess(user, store);

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
  // assertStoreAccess (not assertLocationAccess): a location can hold several
  // stores now (Zone -> multiple Stores), so a plain location-match would let
  // one store's STORE actor see a sibling store's products/inventory too.
  assertStoreAccess(user, store);

  // A customer browsing a store's shelf should only ever see listings the
  // store still carries and whose global product is admin-approved+active —
  // the store/admin managing the shelf needs to see everything, mirroring
  // listInstamartProducts' customer gate in instamartProduct.service.ts.
  const isCustomer = user.userType === 'CUSTOMER';
  const query = isCustomer ? { storeId: id, status: GENERIC_STATUS.ACTIVE } : { storeId: id };

  const [items, total] = await Promise.all([
    InstamartProduct.find(query).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    InstamartProduct.countDocuments(query),
  ]);

  let enriched = await withGlobalProducts(items);
  if (isCustomer) {
    enriched = enriched.filter((p) => globalProductVisible((p.product as IInstamartGlobalProduct | undefined) ?? null));
  }
  return { items: enriched, total };
}

export async function getStoreInventory(id: string, user: JwtPayload, pagination: PaginationParams) {
  const store = await findStoreOrThrow(id);
  assertStoreAccess(user, store);

  const [items, total] = await Promise.all([
    Inventory.find({ storeId: id }).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    Inventory.countDocuments({ storeId: id }),
  ]);
  return { items, total };
}

export async function listStoreDocuments(storeId: string, user: JwtPayload) {
  const store = await findStoreOrThrow(storeId);
  assertStoreAccess(user, store);
  return StoreDocument.find({ storeId }).sort({ createdAt: -1 });
}

export async function addStoreDocument(storeId: string, data: Record<string, unknown>, user: JwtPayload) {
  const store = await findStoreOrThrow(storeId);
  assertStoreAccess(user, store);
  return StoreDocument.create({ ...data, storeId });
}

export async function updateStoreDocument(
  storeId: string,
  documentId: string,
  data: Record<string, unknown>,
  user: JwtPayload,
) {
  const store = await findStoreOrThrow(storeId);
  assertStoreAccess(user, store);

  const document = await StoreDocument.findOneAndUpdate({ _id: documentId, storeId }, data, { new: true });
  if (!document) throw ApiError.notFound('Store document not found', 'STORE_DOCUMENT_NOT_FOUND');
  return document;
}

export async function deleteStoreDocument(storeId: string, documentId: string, user: JwtPayload) {
  const store = await findStoreOrThrow(storeId);
  assertStoreAccess(user, store);

  const document = await StoreDocument.findOneAndDelete({ _id: documentId, storeId });
  if (!document) throw ApiError.notFound('Store document not found', 'STORE_DOCUMENT_NOT_FOUND');
}
