import { connectDatabase, disconnectDatabase } from '../config/database';
import { logger } from './logger';
import { hashPassword } from './password';
import { Location } from '../models/Location';
import { DeliveryZone } from '../models/DeliveryZone';
import { findMatchingZone } from '../services/deliveryZone.service';
import { AdminUser } from '../models/AdminUser';
import { Vendor } from '../models/Vendor';
import { VendorType } from '../models/VendorType';
import { VendorCatalogAccess } from '../models/VendorCatalogAccess';
import { Store } from '../models/Store';
import { StoreType } from '../models/StoreType';
import { Customer } from '../models/Customer';
import { DeliveryPartner } from '../models/DeliveryPartner';
import { FoodCategory } from '../models/FoodCategory';
import { FoodSubcategory } from '../models/FoodSubcategory';
import { FoodProduct } from '../models/FoodProduct';
import { VendorFoodItem } from '../models/VendorFoodItem';
import { FoodVariant } from '../models/FoodVariant';
import { ModifierGroup } from '../models/ModifierGroup';
import { ModifierOption } from '../models/ModifierOption';
import { FoodItemSubmission } from '../models/FoodItemSubmission';
import { InstamartCategory } from '../models/InstamartCategory';
import { InstamartSubcategory } from '../models/InstamartSubcategory';
import { InstamartProduct } from '../models/InstamartProduct';
import { InstamartGlobalProduct } from '../models/InstamartGlobalProduct';
import { InstamartVariant } from '../models/InstamartVariant';
import { Inventory } from '../models/Inventory';
import { ADMIN_ROLES } from '../constants/roles';

const DEV_PASSWORD = process.env.SEED_DEFAULT_PASSWORD || 'ChangeMe123';

async function seedLocations() {
  const locationsData = [
    {
      name: 'Budhana',
      code: 'BUDHANA',
      state: 'Uttar Pradesh',
      district: 'Muzaffarnagar',
      pincodes: ['251309'],
      latitude: 29.288,
      longitude: 77.311,
      serviceRadius: 12,
    },
    {
      name: 'Shahpur',
      code: 'SHAHPUR',
      state: 'Uttar Pradesh',
      district: 'Muzaffarnagar',
      pincodes: ['251201'],
      latitude: 29.4667,
      longitude: 77.6667,
      serviceRadius: 10,
    },
  ];

  const locations = [];
  for (const data of locationsData) {
    const location = await Location.findOneAndUpdate({ code: data.code }, data, { upsert: true, new: true });
    locations.push(location);
  }
  return locations;
}

async function seedDeliveryZones(locations: Awaited<ReturnType<typeof seedLocations>>) {
  for (const location of locations) {
    await DeliveryZone.findOneAndUpdate(
      { locationId: location.id, name: `${location.name} Zone` },
      {
        locationId: location.id,
        name: `${location.name} Zone`,
        centerLatitude: location.latitude,
        centerLongitude: location.longitude,
        radius: location.serviceRadius,
        deliveryFee: 25,
        freeDeliveryAbove: 299,
        maxDistance: location.serviceRadius,
        estimatedDeliveryTime: 30,
        status: 'ACTIVE',
      },
      { upsert: true, new: true },
    );
  }
}

async function seedAdminUsers(locations: Awaited<ReturnType<typeof seedLocations>>) {
  const password = await hashPassword(DEV_PASSWORD);
  const admins = [
    { name: 'Super Admin', email: 'superadmin@example.com', role: ADMIN_ROLES.SUPER_ADMIN, locationIds: [] },
    {
      name: 'Budhana Location Admin',
      email: 'budhana.admin@example.com',
      role: ADMIN_ROLES.LOCATION_ADMIN,
      locationIds: [locations[0].id],
    },
    { name: 'Food Admin', email: 'food.admin@example.com', role: ADMIN_ROLES.FOOD_ADMIN, locationIds: [] },
    { name: 'Instamart Admin', email: 'instamart.admin@example.com', role: ADMIN_ROLES.INSTAMART_ADMIN, locationIds: [] },
    { name: 'Vendor Admin', email: 'vendor.admin@example.com', role: ADMIN_ROLES.VENDOR_ADMIN, locationIds: [] },
    { name: 'Delivery Admin', email: 'delivery.admin@example.com', role: ADMIN_ROLES.DELIVERY_ADMIN, locationIds: [] },
    { name: 'Finance Admin', email: 'finance.admin@example.com', role: ADMIN_ROLES.FINANCE_ADMIN, locationIds: [] },
  ];

  for (const data of admins) {
    await AdminUser.findOneAndUpdate({ email: data.email }, { ...data, password }, { upsert: true, new: true });
  }
}

// A vendor's specialization is now a real admin-managed entity (VendorType),
// not free-text cuisines — seed a small taxonomy so seeded vendors (and the
// Admin Panel/Vendor App signup picker) have real options to reference.
const VENDOR_TYPE_DEFS = [
  { name: 'Multi-Cuisine' },
  { name: 'Pure Veg' },
  { name: 'Cloud Kitchen' },
  { name: 'Bakery & Desserts' },
  { name: 'Fast Food' },
];

async function seedVendorTypes(): Promise<string[]> {
  const ids: string[] = [];
  let displayOrder = 0;
  for (const def of VENDOR_TYPE_DEFS) {
    const vendorType = await VendorType.findOneAndUpdate(
      { name: def.name },
      { name: def.name, displayOrder: displayOrder++, status: 'ACTIVE' },
      { upsert: true, new: true },
    );
    ids.push(vendorType.id);
  }
  return ids;
}

async function seedVendors(locations: Awaited<ReturnType<typeof seedLocations>>, vendorTypeIds: string[]) {
  const password = await hashPassword(DEV_PASSWORD);
  const vendorsData = [
    { restaurantName: 'Spice Junction', phone: '9800000001', locationId: locations[0].id },
    { restaurantName: 'Punjabi Tadka', phone: '9800000002', locationId: locations[0].id },
    { restaurantName: 'South Express', phone: '9800000003', locationId: locations[0].id },
    { restaurantName: 'Pizza Point', phone: '9800000004', locationId: locations[1].id },
    { restaurantName: 'Chinese Wok', phone: '9800000005', locationId: locations[1].id },
  ];

  const vendors = [];
  for (const data of vendorsData) {
    const location = locations.find((l) => l.id === data.locationId)!;
    const vendor = await Vendor.findOneAndUpdate(
      { phone: data.phone },
      {
        ...data,
        ownerName: `${data.restaurantName} Owner`,
        email: `${data.phone}@vendors.example.com`,
        password,
        address: `${data.restaurantName}, ${location.name}`,
        latitude: location.latitude,
        longitude: location.longitude,
        vendorTypeIds: [vendorTypeIds[0]],
        status: 'ACTIVE',
        approvalStatus: 'APPROVED',
        isOpen: true,
      },
      { upsert: true, new: true },
    );
    vendors.push(vendor);
  }
  return vendors;
}

// A one-time migration away from an earlier hand-picked phone scheme
// (9800001001-9800001004) to the fully dynamic per-location generator below —
// removes those specific stores (and their private catalog/inventory) so
// dynamic generation doesn't produce confusing duplicates alongside them.
async function migrateOldHardcodedStores() {
  const oldPhones = ['9800001001', '9800001002', '9800001003', '9800001004'];
  const oldStores = await Store.find({ phone: { $in: oldPhones } });
  for (const old of oldStores) {
    await InstamartProduct.deleteMany({ storeId: old.id });
    await InstamartCategory.deleteMany({ storeId: old.id });
    await Inventory.deleteMany({ storeId: old.id });
    await old.deleteOne();
  }
}

// Store types are now a real admin-managed entity (StoreType), not a
// hardcoded enum — seed a full taxonomy so the Admin Panel has real options
// to pick from, keyed here only so seedStores/seedStoreInstamartCatalog can
// look up "the Grocery type's id" etc. without hardcoding ids.
const STORE_TYPE_DEFS = [
  { key: 'GROCERY', name: 'Grocery' },
  { key: 'VEG_FRUITS', name: 'Fruits & Vegetables' },
  { key: 'COSMETICS', name: 'Cosmetics' },
  { key: 'PERSONAL_CARE', name: 'Personal Care' },
  { key: 'DAIRY_BAKERY', name: 'Bakery & Dairy' },
  { key: 'SUPERMARKET', name: 'Supermarket' },
  { key: 'CONVENIENCE', name: 'Convenience Store' },
  { key: 'GENERAL', name: 'General Store' },
  { key: 'PHARMACY', name: 'Pharmacy' },
  { key: 'MEAT_FISH', name: 'Meat & Fish' },
  { key: 'OTHER', name: 'Other' },
];

async function seedStoreTypes(): Promise<Record<string, string>> {
  const idByKey: Record<string, string> = {};
  let sortOrder = 0;
  for (const def of STORE_TYPE_DEFS) {
    const storeType = await StoreType.findOneAndUpdate(
      { name: def.name },
      { name: def.name, sortOrder: sortOrder++, status: 'ACTIVE' },
      { upsert: true, new: true },
    );
    idByKey[def.key] = storeType.id;
  }
  return idByKey;
}

// One-time migration from the earlier single storeTypeId field to today's
// storeTypeIds array (a store may support more than one type). Mongoose's
// autoIndex never drops an index that's no longer declared in the schema, so
// the old single-field unique index must be dropped explicitly — otherwise
// every migrated document (storeTypeId unset -> indexed as null) collides
// under the stale index the moment a second one shares a zone.
async function migrateStoreTypeIdToArray() {
  try {
    await Store.collection.dropIndex('deliveryZoneId_1_storeTypeId_1');
  } catch {
    // already dropped, or never existed on this database — fine either way.
  }

  const legacyStores = await Store.collection.find({ storeTypeId: { $exists: true } }).toArray();
  for (const doc of legacyStores) {
    await Store.collection.updateOne(
      { _id: doc._id },
      {
        $set: { storeTypeIds: [doc.storeTypeId], approvalStatus: doc.approvalStatus ?? 'APPROVED' },
        $unset: { storeTypeId: '' },
      },
    );
  }
}

async function seedStores(locations: Awaited<ReturnType<typeof seedLocations>>, storeTypeIdByKey: Record<string, string>) {
  await migrateStoreTypeIdToArray();
  await migrateOldHardcodedStores();

  const password = await hashPassword(DEV_PASSWORD);
  const storesData: { name: string; storeTypeIds: string[]; typeKeys: string[]; phone: string; locationId: string }[] = [];
  let phoneCounter = 9800003001;

  locations.forEach((location, locationIndex) => {
    if (locationIndex === 0) {
      // A store may support more than one type (Store A: Grocery + Bakery &
      // Dairy) — demonstrated directly here for the first location, rather
      // than needing two separate stores to cover both.
      storesData.push({
        name: `${location.name} Supermarket`,
        storeTypeIds: [storeTypeIdByKey.GROCERY, storeTypeIdByKey.DAIRY_BAKERY],
        typeKeys: ['GROCERY', 'DAIRY_BAKERY'],
        phone: String(phoneCounter++),
        locationId: location.id,
      });
    } else {
      storesData.push({
        name: `${location.name} Daily Mart`,
        storeTypeIds: [storeTypeIdByKey.GROCERY],
        typeKeys: ['GROCERY'],
        phone: String(phoneCounter++),
        locationId: location.id,
      });
    }
    storesData.push({
      name: `${location.name} Veg & Fruits`,
      storeTypeIds: [storeTypeIdByKey.VEG_FRUITS],
      typeKeys: ['VEG_FRUITS'],
      phone: String(phoneCounter++),
      locationId: location.id,
    });
    storesData.push({
      name: `${location.name} Beauty & Cosmetics`,
      storeTypeIds: [storeTypeIdByKey.COSMETICS],
      typeKeys: ['COSMETICS'],
      phone: String(phoneCounter++),
      locationId: location.id,
    });
  });

  const stores = [];
  for (const { typeKeys, ...data } of storesData) {
    const location = locations.find((l) => l.id === data.locationId)!;
    // Same resolution a real store-creation call uses (store.service.ts) —
    // the seeded DeliveryZone is centered on this same location, so this
    // trivially resolves to it.
    const zone = await findMatchingZone(data.locationId, location.latitude, location.longitude);
    if (!zone) throw new Error(`No delivery zone found for location ${location.name} — seed a zone before stores`);

    const store = await Store.findOneAndUpdate(
      { phone: data.phone },
      {
        ...data,
        deliveryZoneId: zone.id,
        managerName: `${data.name} Manager`,
        email: `${data.phone}@stores.example.com`,
        password,
        address: `${data.name}, ${location.name}`,
        latitude: location.latitude,
        longitude: location.longitude,
        status: 'ACTIVE',
        approvalStatus: 'APPROVED',
      },
      { upsert: true, new: true },
    );
    // Not persisted on the document — just carried alongside for
    // seedStoreInstamartCatalog to pick the right product catalogs below.
    (store as unknown as { _typeKeys: string[] })._typeKeys = typeKeys;
    stores.push(store);
  }
  return stores;
}

async function seedFoodCatalog(locations: Awaited<ReturnType<typeof seedLocations>>, vendors: Awaited<ReturnType<typeof seedVendors>>) {
  const category = await FoodCategory.findOneAndUpdate(
    { name: 'North Indian' },
    { name: 'North Indian', status: 'ACTIVE' },
    { upsert: true, new: true },
  );
  const subcategory = await FoodSubcategory.findOneAndUpdate(
    { categoryId: category.id, name: 'Curries' },
    { categoryId: category.id, name: 'Curries', status: 'ACTIVE' },
    { upsert: true, new: true },
  );

  // GLOBAL Food Items (Stage 2) — one canonical "Paneer Butter Masala" every
  // vendor below lists its own price against (see FoodProduct.ts / VendorFoodItem.ts).
  const paneerButterMasala = await FoodProduct.findOneAndUpdate(
    { name: 'Paneer Butter Masala', categoryId: category.id },
    {
      categoryId: category.id,
      subcategoryId: subcategory.id,
      name: 'Paneer Butter Masala',
      description: 'Creamy tomato-based curry with paneer',
      foodType: 'VEG',
      status: 'ACTIVE',
    },
    { upsert: true, new: true },
  );

  for (const vendor of vendors) {
    // Admin-controlled allow-list — a vendor may only list items under a
    // global category/subcategory it has been granted access to (see
    // VendorCatalogAccess.ts). subcategoryId: null grants the whole category.
    await VendorCatalogAccess.findOneAndUpdate(
      { vendorId: vendor.id, categoryId: category.id, subcategoryId: null },
      { vendorId: vendor.id, categoryId: category.id, subcategoryId: null },
      { upsert: true, new: true },
    );

    // The vendor's own priced listing onto the shared global item.
    const vendorFoodItem = await VendorFoodItem.findOneAndUpdate(
      { vendorId: vendor.id, globalFoodItemId: paneerButterMasala.id },
      {
        vendorId: vendor.id,
        globalFoodItemId: paneerButterMasala.id,
        price: 220,
        mrp: 240,
        preparationTime: 20,
        status: 'ACTIVE',
      },
      { upsert: true, new: true },
    );

    await FoodVariant.findOneAndUpdate(
      { vendorFoodItemId: vendorFoodItem.id, name: 'Half' },
      { vendorFoodItemId: vendorFoodItem.id, name: 'Half', price: 130, isDefault: false, status: 'ACTIVE' },
      { upsert: true, new: true },
    );
    await FoodVariant.findOneAndUpdate(
      { vendorFoodItemId: vendorFoodItem.id, name: 'Full' },
      { vendorFoodItemId: vendorFoodItem.id, name: 'Full', price: 220, isDefault: true, status: 'ACTIVE' },
      { upsert: true, new: true },
    );

    // One required modifier group with two free options, just enough to
    // exercise the min/max/required validation in order.service.ts.
    const spiceLevelGroup = await ModifierGroup.findOneAndUpdate(
      { vendorFoodItemId: vendorFoodItem.id, name: 'Spice Level' },
      {
        vendorFoodItemId: vendorFoodItem.id,
        name: 'Spice Level',
        minSelection: 1,
        maxSelection: 1,
        required: true,
        status: 'ACTIVE',
      },
      { upsert: true, new: true },
    );
    await ModifierOption.findOneAndUpdate(
      { modifierGroupId: spiceLevelGroup.id, name: 'Mild' },
      { modifierGroupId: spiceLevelGroup.id, name: 'Mild', price: 0, status: 'ACTIVE' },
      { upsert: true, new: true },
    );
    await ModifierOption.findOneAndUpdate(
      { modifierGroupId: spiceLevelGroup.id, name: 'Spicy' },
      { modifierGroupId: spiceLevelGroup.id, name: 'Spicy', price: 0, status: 'ACTIVE' },
      { upsert: true, new: true },
    );
  }

  // A vendor's "this item doesn't exist yet" proposal, awaiting admin review
  // (see FoodItemSubmission.ts / foodItemSubmission.service.ts).
  const firstVendor = vendors[0];
  if (firstVendor) {
    await FoodItemSubmission.findOneAndUpdate(
      { vendorId: firstVendor.id, name: 'Butter Naan Combo' },
      {
        vendorId: firstVendor.id,
        name: 'Butter Naan Combo',
        categoryId: category.id,
        subcategoryId: subcategory.id,
        description: 'Two butter naans with a side of dal makhani',
        foodType: 'VEG',
        price: 180,
        mrp: 200,
        preparationTime: 15,
        status: 'PENDING_APPROVAL',
      },
      { upsert: true, new: true },
    );
  }

  void locations;
}

interface ProductSeed {
  name: string;
  brand: string;
  sku: string;
  mrp: number;
  sellingPrice: number;
  discount: number;
  unit: string;
  packSize: string;
  image: string;
}
interface SubcategorySeed {
  name: string;
  products?: ProductSeed[];
}
interface CategorySeed {
  name: string;
  // Which store type(s) this top-level category is relevant to — drives both
  // InstamartCategory.storeTypeIds (so a store's dashboard only shows
  // matching categories) and which stores get demo products seeded below.
  storeTypeKeys: string[];
  subcategories: SubcategorySeed[];
}

// The full global category/subcategory taxonomy — every entry here is
// created regardless of whether it has demo products (so the whole tree is
// immediately visible/manageable from the Admin Panel, per "categories
// should be configurable from Admin Portal"). Only a handful of
// subcategories carry demo products, just enough to exercise the real
// Global Product -> Multiple Stores flow end-to-end.
const GLOBAL_TAXONOMY: CategorySeed[] = [
  {
    name: 'Grocery',
    storeTypeKeys: ['GROCERY', 'SUPERMARKET', 'GENERAL', 'CONVENIENCE'],
    subcategories: [
      {
        name: 'Atta & Flour',
        products: [
          { name: 'Aashirvaad Atta', brand: 'Aashirvaad', sku: 'GR-ATTA-5KG', mrp: 288, sellingPrice: 245, discount: 15, unit: 'kg', packSize: '5kg', image: 'atta.png' },
        ],
      },
      {
        name: 'Rice',
        products: [
          { name: 'Basmati Rice', brand: 'Local', sku: 'GR-RICE-1KG', mrp: 120, sellingPrice: 110, discount: 8, unit: 'kg', packSize: '1kg', image: 'rice.png' },
        ],
      },
      { name: 'Daal & Pulses' },
      { name: 'Oil & Ghee' },
      { name: 'Spices & Masala' },
      { name: 'Sugar & Salt' },
      { name: 'Dry Fruits' },
      { name: 'Grains' },
      { name: 'Instant Food' },
      { name: 'Packaged Food' },
    ],
  },
  {
    name: 'Fruits & Vegetables',
    storeTypeKeys: ['VEG_FRUITS', 'SUPERMARKET', 'GENERAL'],
    subcategories: [
      {
        name: 'Fresh Fruits',
        products: [
          { name: 'Banana', brand: 'Farm Fresh', sku: 'FV-BANANA-1KG', mrp: 60, sellingPrice: 48, discount: 20, unit: 'kg', packSize: '1kg', image: 'banana.png' },
          { name: 'Apple (Shimla)', brand: 'Farm Fresh', sku: 'FV-APPLE-1KG', mrp: 180, sellingPrice: 149, discount: 17, unit: 'kg', packSize: '1kg', image: 'apple.png' },
        ],
      },
      {
        name: 'Fresh Vegetables',
        products: [
          { name: 'Tomato', brand: 'Farm Fresh', sku: 'FV-TOMATO-1KG', mrp: 40, sellingPrice: 34, discount: 15, unit: 'kg', packSize: '1kg', image: 'tomato.png' },
        ],
      },
      {
        name: 'Leafy Vegetables',
        products: [
          { name: 'Spinach (Palak)', brand: 'Farm Fresh', sku: 'FV-SPINACH-250G', mrp: 25, sellingPrice: 20, discount: 20, unit: 'pack', packSize: '250g', image: 'spinach.png' },
        ],
      },
      { name: 'Exotic Fruits' },
      { name: 'Exotic Vegetables' },
      { name: 'Herbs' },
    ],
  },
  {
    name: 'Cosmetics',
    storeTypeKeys: ['COSMETICS', 'PERSONAL_CARE', 'SUPERMARKET'],
    subcategories: [
      {
        name: 'Face Care',
        products: [
          { name: 'Himalaya Face Wash', brand: 'Himalaya', sku: 'CO-FACEWASH-100ML', mrp: 120, sellingPrice: 99, discount: 17, unit: 'pack', packSize: '100ml', image: 'facewash.png' },
        ],
      },
      { name: 'Makeup' },
      {
        name: 'Hair Care',
        products: [
          { name: 'Head & Shoulders Shampoo', brand: 'Head & Shoulders', sku: 'CO-SHAMPOO-180ML', mrp: 199, sellingPrice: 169, discount: 15, unit: 'pack', packSize: '180ml', image: 'shampoo.png' },
        ],
      },
      {
        name: 'Skin Care',
        products: [
          { name: 'Nivea Body Lotion', brand: 'Nivea', sku: 'CO-BODYLOTION-200ML', mrp: 250, sellingPrice: 210, discount: 16, unit: 'pack', packSize: '200ml', image: 'body-lotion.png' },
        ],
      },
      { name: 'Fragrances' },
      { name: "Men's Grooming" },
    ],
  },
  {
    name: 'Personal Care',
    storeTypeKeys: ['PERSONAL_CARE', 'COSMETICS', 'SUPERMARKET', 'GENERAL'],
    subcategories: [
      {
        name: 'Bath & Body',
        products: [
          { name: 'Dove Soap', brand: 'Dove', sku: 'PC-DOVESOAP-100G', mrp: 45, sellingPrice: 38, discount: 15, unit: 'pack', packSize: '100g', image: 'dove-soap.png' },
        ],
      },
      { name: 'Oral Care' },
      { name: 'Feminine Care' },
      { name: 'Hygiene' },
      { name: 'Baby Care' },
      { name: 'Grooming' },
    ],
  },
  {
    name: 'Bakery & Dairy',
    storeTypeKeys: ['DAIRY_BAKERY', 'SUPERMARKET', 'GENERAL'],
    subcategories: [
      {
        name: 'Milk',
        products: [
          { name: 'Amul Taaza Milk', brand: 'Amul', sku: 'BD-MILK-1L', mrp: 66, sellingPrice: 56, discount: 15, unit: 'pack', packSize: '1L', image: 'milk.png' },
        ],
      },
      { name: 'Curd' },
      {
        name: 'Paneer',
        products: [
          { name: 'Paneer', brand: 'Local', sku: 'BD-PANEER-200G', mrp: 90, sellingPrice: 79, discount: 12, unit: 'pack', packSize: '200g', image: 'paneer.png' },
        ],
      },
      { name: 'Butter' },
      { name: 'Cheese' },
      { name: 'Bread' },
      { name: 'Cakes' },
      { name: 'Biscuits' },
      { name: 'Bakery Items' },
    ],
  },
  {
    name: 'Beverages',
    storeTypeKeys: ['GROCERY', 'SUPERMARKET', 'GENERAL', 'CONVENIENCE'],
    subcategories: [
      { name: 'Soft Drinks' },
      { name: 'Juices' },
      { name: 'Energy Drinks' },
      { name: 'Tea' },
      { name: 'Coffee' },
      { name: 'Water' },
    ],
  },
  {
    name: 'Snacks',
    storeTypeKeys: ['GROCERY', 'SUPERMARKET', 'GENERAL', 'CONVENIENCE'],
    subcategories: [
      {
        name: 'Chips',
        products: [
          { name: "Lay's Classic", brand: "Lay's", sku: 'SN-LAYS-52G', mrp: 25, sellingPrice: 20, discount: 20, unit: 'pack', packSize: '52g', image: 'lays.png' },
        ],
      },
      { name: 'Namkeen' },
      { name: 'Chocolates' },
      { name: 'Sweets' },
      { name: 'Cookies' },
    ],
  },
];

// Categories/subcategories are shared, admin-managed taxonomy (global —
// locationId: null — so every zone/store sees the same canonical list; see
// instamartCategory.service.ts). Created once here, then every store's own
// products reference the same category/subcategory ids — a marketplace of
// independent stores needs one "Fruits & Vegetables", not one per store.
// One-time cleanup of the store-private categories an earlier version of
// this seed script created (InstamartCategory no longer has a storeId field
// at all — those documents are now orphaned and would otherwise duplicate
// the shared taxonomy below in the customer view).
async function migrateOldStorePrivateCategories() {
  const orphanCategoryIds = await InstamartCategory.collection
    .find({ storeId: { $exists: true } })
    .map((doc) => doc._id)
    .toArray();
  if (orphanCategoryIds.length === 0) return;
  await InstamartSubcategory.deleteMany({ categoryId: { $in: orphanCategoryIds } });
  await InstamartCategory.collection.deleteMany({ _id: { $in: orphanCategoryIds } });
}

// One-time migration away from an earlier, differently-named catalog
// ('Dairy & Bakery'/'Staples & Snacks'/'Household Essentials'/'Beauty &
// Personal Care' categories; 'Veg & Fruits'/'Dairy & Bakery'/'Meat & Seafood'
// store types) to today's spec-aligned taxonomy. Upserting by name only
// creates new documents alongside the old ones — it never renames them — so
// this explicitly removes the superseded categories (cascading to their
// subcategories and any products/inventory still pointing at them) and
// store types. Safe to run repeatedly: a no-op once nothing matches anymore.
async function migrateSupersededInstamartTaxonomy() {
  const staleCategoryNames = ['Dairy & Bakery', 'Staples & Snacks', 'Household Essentials', 'Beauty & Personal Care'];
  const staleCategories = await InstamartCategory.find({ name: { $in: staleCategoryNames }, locationId: null });
  const staleCategoryIds = staleCategories.map((c) => c.id);
  if (staleCategoryIds.length > 0) {
    const staleProducts = await InstamartProduct.find({ categoryId: { $in: staleCategoryIds } });
    const staleProductIds = staleProducts.map((p) => p.id);
    await Inventory.deleteMany({ productId: { $in: staleProductIds } });
    await InstamartProduct.deleteMany({ _id: { $in: staleProductIds } });
    await InstamartSubcategory.deleteMany({ categoryId: { $in: staleCategoryIds } });
    await InstamartCategory.deleteMany({ _id: { $in: staleCategoryIds } });
  }

  await StoreType.deleteMany({ name: { $in: ['Veg & Fruits', 'Meat & Seafood', 'Dairy & Bakery'] } });
}

// One-time migration for the Global Product Master / Store-Product Mapping
// split: InstamartProduct used to carry name/brand/mrp/images/etc. directly;
// it's now a per-store mapping onto a separate InstamartGlobalProduct, keyed
// by a required `productId` field that didn't exist before. Old-shape
// documents (from before this migration ran) have no `productId` at all and
// can't be salvaged into the new shape (their name/brand/etc. now belong on
// a different collection) — simplest safe fix is to delete them, the same
// as migrateSupersededInstamartTaxonomy does for superseded categories, and
// let seedGlobalProducts/seedStoreInstamartCatalog below recreate them in
// the new shape.
async function migrateProductSplitToGlobalCatalog() {
  const oldShapeIds = await InstamartProduct.collection
    .find({ productId: { $exists: false } })
    .map((doc) => doc._id)
    .toArray();
  if (oldShapeIds.length === 0) return;
  await Inventory.deleteMany({ productId: { $in: oldShapeIds } });
  await InstamartVariant.deleteMany({ productId: { $in: oldShapeIds } });
  await InstamartProduct.collection.deleteMany({ _id: { $in: oldShapeIds } });
}

async function seedGlobalInstamartTaxonomy(
  storeTypeIdByKey: Record<string, string>,
): Promise<Record<string, { categoryId: string; subcategoryId: string }>> {
  await migrateOldStorePrivateCategories();
  await migrateSupersededInstamartTaxonomy();
  await migrateProductSplitToGlobalCatalog();

  const ids: Record<string, { categoryId: string; subcategoryId: string }> = {};
  let categorySortOrder = 0;
  for (const categorySeed of GLOBAL_TAXONOMY) {
    const storeTypeIds = categorySeed.storeTypeKeys.map((key) => storeTypeIdByKey[key]).filter(Boolean);
    const category = await InstamartCategory.findOneAndUpdate(
      { name: categorySeed.name, locationId: null },
      { name: categorySeed.name, locationId: null, storeTypeIds, sortOrder: categorySortOrder++, status: 'ACTIVE' },
      { upsert: true, new: true },
    );

    let subcategorySortOrder = 0;
    for (const subcategorySeed of categorySeed.subcategories) {
      const subcategory = await InstamartSubcategory.findOneAndUpdate(
        { categoryId: category.id, name: subcategorySeed.name },
        { categoryId: category.id, name: subcategorySeed.name, sortOrder: subcategorySortOrder++, status: 'ACTIVE' },
        { upsert: true, new: true },
      );
      ids[`${categorySeed.name}::${subcategorySeed.name}`] = { categoryId: category.id, subcategoryId: subcategory.id };
    }
  }
  return ids;
}

// The shared Global Product Master — one canonical "Aashirvaad Atta 5kg"
// regardless of how many stores end up selling it (see
// InstamartGlobalProduct). Keyed by name+categoryId since the demo data has
// no barcode; every store that lists a product below maps onto the same
// document instead of duplicating name/brand/mrp/images per store.
async function seedGlobalProducts(
  taxonomyIds: Record<string, { categoryId: string; subcategoryId: string }>,
): Promise<Record<string, string>> {
  const productIds: Record<string, string> = {};
  for (const categorySeed of GLOBAL_TAXONOMY) {
    for (const subcategorySeed of categorySeed.subcategories) {
      if (!subcategorySeed.products?.length) continue;
      const { categoryId, subcategoryId } = taxonomyIds[`${categorySeed.name}::${subcategorySeed.name}`];

      for (const item of subcategorySeed.products) {
        const product = await InstamartGlobalProduct.findOneAndUpdate(
          { name: item.name, categoryId },
          {
            name: item.name,
            brand: item.brand,
            categoryId,
            subcategoryId,
            unit: item.unit,
            packSize: item.packSize,
            mrp: item.mrp,
            images: [`https://res.cloudinary.com/demo/image/upload/${item.image}`],
            approvalStatus: 'APPROVED',
            status: 'ACTIVE',
          },
          { upsert: true, new: true },
        );
        productIds[item.sku] = product.id;
      }
    }
  }
  return productIds;
}

async function seedStoreInstamartCatalog(
  stores: Awaited<ReturnType<typeof seedStores>>,
  storeTypeIdByKey: Record<string, string>,
) {
  const taxonomyIds = await seedGlobalInstamartTaxonomy(storeTypeIdByKey);
  const globalProductIdBySku = await seedGlobalProducts(taxonomyIds);

  for (const store of stores) {
    const typeKeys = (store as unknown as { _typeKeys?: string[] })._typeKeys ?? ['GROCERY'];
    // A multi-type store (e.g. Grocery + Bakery & Dairy) gets the union of
    // every category matching any of its types — same store, several types.
    const categories = GLOBAL_TAXONOMY.filter((c) => c.storeTypeKeys.some((k) => typeKeys.includes(k)));

    for (const categorySeed of categories) {
      for (const subcategorySeed of categorySeed.subcategories) {
        if (!subcategorySeed.products?.length) continue;
        const { categoryId, subcategoryId } = taxonomyIds[`${categorySeed.name}::${subcategorySeed.name}`];

        for (const item of subcategorySeed.products) {
          const globalProductId = globalProductIdBySku[item.sku];
          const product = await InstamartProduct.findOneAndUpdate(
            { storeId: store.id, productId: globalProductId },
            {
              locationId: store.locationId,
              storeId: store.id,
              productId: globalProductId,
              categoryId,
              subcategoryId,
              sku: item.sku,
              sellingPrice: item.sellingPrice,
              discount: item.discount,
              status: 'ACTIVE',
            },
            { upsert: true, new: true },
          );

          await Inventory.findOneAndUpdate(
            { storeId: store.id, productId: product.id },
            {
              locationId: store.locationId,
              storeId: store.id,
              productId: product.id,
              currentStock: 150,
              reservedStock: 0,
              minimumStock: 10,
              maximumStock: 500,
            },
            { upsert: true, new: true },
          );
        }
      }
    }
  }
}

async function seedInstamartCatalog(stores: Awaited<ReturnType<typeof seedStores>>, storeTypeIdByKey: Record<string, string>) {
  await seedStoreInstamartCatalog(stores, storeTypeIdByKey);
}

async function seedCustomers() {
  const customers = Array.from({ length: 20 }, (_, i) => ({
    name: `Customer ${i + 1}`,
    phone: `98${(10000000 + i).toString().padStart(8, '0')}`,
  }));

  for (const data of customers) {
    await Customer.findOneAndUpdate({ phone: data.phone }, data, { upsert: true, new: true });
  }
}

async function seedDeliveryPartners(locations: Awaited<ReturnType<typeof seedLocations>>) {
  const password = await hashPassword(DEV_PASSWORD);
  const partnersData = Array.from({ length: 5 }, (_, i) => ({
    name: `Delivery Partner ${i + 1}`,
    phone: `97${(10000000 + i).toString().padStart(8, '0')}`,
    locationId: locations[i % locations.length].id,
  }));

  for (const data of partnersData) {
    await DeliveryPartner.findOneAndUpdate(
      { phone: data.phone },
      { ...data, password, status: 'ACTIVE', availability: 'OFFLINE' },
      { upsert: true, new: true },
    );
  }
}

async function run() {
  await connectDatabase();
  logger.info('Seeding development data...');

  const locations = await seedLocations();
  await seedDeliveryZones(locations);
  await seedAdminUsers(locations);
  const vendorTypeIds = await seedVendorTypes();
  const vendors = await seedVendors(locations, vendorTypeIds);
  const storeTypeIdByKey = await seedStoreTypes();
  const stores = await seedStores(locations, storeTypeIdByKey);
  await seedFoodCatalog(locations, vendors);
  await seedInstamartCatalog(stores, storeTypeIdByKey);
  await seedCustomers();
  await seedDeliveryPartners(locations);

  logger.info(`Seed complete. Default password for seeded accounts: ${DEV_PASSWORD}`);
  await disconnectDatabase();
  process.exit(0);
}

run().catch((err) => {
  logger.error({ err }, 'Seed failed');
  process.exit(1);
});
