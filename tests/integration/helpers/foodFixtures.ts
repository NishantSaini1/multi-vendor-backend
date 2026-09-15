import { Vendor, IVendor } from '../../../src/models/Vendor';
import { VendorType } from '../../../src/models/VendorType';
import { FoodProduct, IFoodProduct } from '../../../src/models/FoodProduct';
import { VendorFoodItem, IVendorFoodItem } from '../../../src/models/VendorFoodItem';
import { VendorCatalogAccess } from '../../../src/models/VendorCatalogAccess';
import { Store, IStore } from '../../../src/models/Store';
import { StoreType } from '../../../src/models/StoreType';
import { DeliveryZone } from '../../../src/models/DeliveryZone';
import { InstamartGlobalProduct, IInstamartGlobalProduct } from '../../../src/models/InstamartGlobalProduct';
import { InstamartProduct, IInstamartProduct } from '../../../src/models/InstamartProduct';

// Shared fixture helpers for the integration suite — added when Stages 1-2
// made `vendorTypeIds` a required, non-empty field on Vendor (and
// `storeTypeIds`/`deliveryZoneId`/`password` required on Store) and split the
// old vendor-owned FoodProduct (price/discount/tax/isAvailable directly on
// it) into a GLOBAL FoodProduct + a per-vendor VendorFoodItem. Every test file
// that creates a Vendor/Store or a Food item for ordering should go through
// these rather than re-inlining the new shape everywhere.

let vendorTypeCounter = 0;

// A fresh VendorType per call by default — cheap, and test files don't care
// about reusing one across files (each gets its own DB via
// mongodb-memory-server per test run/suite).
export async function createTestVendorType(overrides: Record<string, unknown> = {}) {
  vendorTypeCounter += 1;
  return VendorType.create({
    name: `Test Vendor Type ${Date.now()}-${vendorTypeCounter}`,
    status: 'ACTIVE',
    ...overrides,
  });
}

// Drop-in replacement for `Vendor.create({...})` — same payload shape as
// before, just also satisfies the now-required, non-empty `vendorTypeIds`
// (auto-creating one unless the caller already supplied it).
export async function createTestVendor(data: Record<string, unknown>): Promise<IVendor> {
  let payload = data;
  if (!payload.vendorTypeIds) {
    const vendorType = await createTestVendorType();
    payload = { ...payload, vendorTypeIds: [vendorType.id] };
  }
  return Vendor.create(payload);
}

// Creates the GLOBAL Food Item (FoodProduct) — no price/vendorId/isAvailable
// on it anymore (see FoodProduct.ts); those live on VendorFoodItem instead.
export async function createGlobalFoodItem(
  categoryId: string,
  overrides: Record<string, unknown> = {},
): Promise<IFoodProduct> {
  return FoodProduct.create({
    categoryId,
    name: 'Test Global Item',
    foodType: 'VEG',
    status: 'ACTIVE',
    ...overrides,
  });
}

// Creates a vendor's own priced listing onto a global item.
export async function createVendorFoodItem(
  vendorId: string,
  globalFoodItemId: string,
  overrides: Record<string, unknown> = {},
): Promise<IVendorFoodItem> {
  return VendorFoodItem.create({
    vendorId,
    globalFoodItemId,
    price: 100,
    availabilityStatus: 'AVAILABLE',
    status: 'ACTIVE',
    ...overrides,
  });
}

// The common case most test files actually want: "a vendor has ONE orderable
// Food item at a given price" — creates the global item + the vendor's own
// listing in one call and returns the VendorFoodItem (its `.id` is what goes
// into an order's `items[].productId`, exactly like the old flat
// FoodProduct's `.id` used to). `overrides.name`/`foodType` go to the global
// item; everything else (`price`, `mrp`, `availabilityStatus`, `status`, ...)
// goes to the VendorFoodItem.
export async function createOrderableFoodItem(
  vendorId: string,
  categoryId: string,
  overrides: { name?: string; foodType?: string; subcategoryId?: string } & Record<string, unknown> = {},
): Promise<IVendorFoodItem> {
  const { name, foodType, subcategoryId, ...vendorOverrides } = overrides;
  const globalItem = await createGlobalFoodItem(categoryId, { name, foodType, subcategoryId });
  return createVendorFoodItem(vendorId, globalItem.id, vendorOverrides);
}

// Admin-controlled allow-list grant — only needed by tests that exercise the
// HTTP "add existing item" / FoodItemSubmission flow (which enforce it in the
// service layer); tests that create a VendorFoodItem directly via the model
// (createOrderableFoodItem above) don't need this at all.
export async function grantCatalogAccess(vendorId: string, categoryId: string, subcategoryId: string | null = null) {
  return VendorCatalogAccess.create({ vendorId, categoryId, subcategoryId });
}

let storeTypeCounter = 0;

// A fresh StoreType per call by default, mirroring createTestVendorType.
export async function createTestStoreType(overrides: Record<string, unknown> = {}) {
  storeTypeCounter += 1;
  return StoreType.create({
    name: `Test Store Type ${Date.now()}-${storeTypeCounter}`,
    status: 'ACTIVE',
    ...overrides,
  });
}

let deliveryZoneCounter = 0;

// A fresh, permissive radius-based DeliveryZone per call — only used as a
// stand-in to satisfy Store.deliveryZoneId's required-field constraint for
// tests that create a Store directly via the model (not through
// store.service.ts's createStore, which resolves the zone for real from
// lat/long via deliveryZone.service.ts's findMatchingZone).
export async function createTestDeliveryZone(locationId: string, overrides: Record<string, unknown> = {}) {
  deliveryZoneCounter += 1;
  return DeliveryZone.create({
    locationId,
    name: `Test Zone ${Date.now()}-${deliveryZoneCounter}`,
    centerLatitude: 0,
    centerLongitude: 0,
    radius: 1000,
    deliveryFee: 20,
    freeDeliveryAbove: 500,
    estimatedDeliveryTime: 30,
    status: 'ACTIVE',
    ...overrides,
  });
}

// Drop-in replacement for `Store.create({...})` — same payload shape as
// before, just also satisfies the now-required `storeTypeIds` (non-empty),
// `deliveryZoneId`, and `password` fields (auto-filling each unless the
// caller already supplied it).
export async function createTestStore(data: Record<string, unknown>): Promise<IStore> {
  let payload = data;
  if (!payload.storeTypeIds) {
    const storeType = await createTestStoreType();
    payload = { ...payload, storeTypeIds: [storeType.id] };
  }
  if (!payload.deliveryZoneId) {
    const zone = await createTestDeliveryZone(payload.locationId as string);
    payload = { ...payload, deliveryZoneId: zone.id };
  }
  if (!payload.password) {
    payload = { ...payload, password: 'TestStorePass123' };
  }
  return Store.create(payload);
}

// Creates the GLOBAL Instamart product (InstamartGlobalProduct) — the
// centralized catalog entry (name/brand/unit/mrp/images) every store's own
// InstamartProduct listing maps onto, mirroring FoodProduct/VendorFoodItem
// above (see InstamartGlobalProduct.ts / InstamartProduct.ts).
export async function createInstamartGlobalProduct(
  categoryId: string,
  overrides: Record<string, unknown> = {},
): Promise<IInstamartGlobalProduct> {
  return InstamartGlobalProduct.create({
    categoryId,
    name: 'Test Global Product',
    unit: 'pc',
    mrp: 100,
    approvalStatus: 'APPROVED',
    status: 'ACTIVE',
    ...overrides,
  });
}

// The common case most test files actually want: "a store has ONE orderable
// Instamart listing at a given price" — creates the global product + the
// store's own mapping in one call and returns the InstamartProduct (its
// `.id` is what goes into an order's `items[].productId` and Inventory's
// `productId`, exactly like the old flat InstamartProduct's `.id` used to).
// `overrides.name`/`unit`/`mrp`/`subcategoryId` go to the global product;
// everything else (`sellingPrice`, `discount`, `sku`, `status`, ...) goes to
// the store's InstamartProduct listing.
export async function createInstamartListing(
  locationId: string,
  storeId: string,
  categoryId: string,
  overrides: { name?: string; unit?: string; mrp?: number; subcategoryId?: string } & Record<string, unknown> = {},
): Promise<IInstamartProduct> {
  const { name, unit, mrp, subcategoryId, ...listingOverrides } = overrides;
  const globalProduct = await createInstamartGlobalProduct(categoryId, { name, unit, mrp, subcategoryId });
  return InstamartProduct.create({
    locationId,
    storeId,
    productId: globalProduct.id,
    categoryId,
    subcategoryId,
    sellingPrice: 90,
    status: 'ACTIVE',
    ...listingOverrides,
  });
}
