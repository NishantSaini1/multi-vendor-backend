import { connectDatabase, disconnectDatabase } from '../config/database';
import { logger } from './logger';
import { hashPassword } from './password';
import { Location } from '../models/Location';
import { AdminUser } from '../models/AdminUser';
import { Vendor } from '../models/Vendor';
import { Store } from '../models/Store';
import { Customer } from '../models/Customer';
import { DeliveryPartner } from '../models/DeliveryPartner';
import { FoodCategory } from '../models/FoodCategory';
import { FoodSubcategory } from '../models/FoodSubcategory';
import { FoodProduct } from '../models/FoodProduct';
import { InstamartCategory } from '../models/InstamartCategory';
import { InstamartSubcategory } from '../models/InstamartSubcategory';
import { InstamartProduct } from '../models/InstamartProduct';
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

async function seedVendors(locations: Awaited<ReturnType<typeof seedLocations>>) {
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
        cuisines: ['Indian'],
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

async function seedStores(locations: Awaited<ReturnType<typeof seedLocations>>) {
  const storesData = [
    { name: 'Budhana Daily Mart', phone: '9800001001', locationId: locations[0].id },
    { name: 'Shahpur Fresh Store', phone: '9800001002', locationId: locations[1].id },
  ];

  const stores = [];
  for (const data of storesData) {
    const location = locations.find((l) => l.id === data.locationId)!;
    const store = await Store.findOneAndUpdate(
      { phone: data.phone },
      {
        ...data,
        managerName: `${data.name} Manager`,
        email: `${data.phone}@stores.example.com`,
        address: `${data.name}, ${location.name}`,
        latitude: location.latitude,
        longitude: location.longitude,
        status: 'ACTIVE',
      },
      { upsert: true, new: true },
    );
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

  for (const vendor of vendors) {
    await FoodProduct.findOneAndUpdate(
      { vendorId: vendor.id, name: 'Paneer Butter Masala' },
      {
        locationId: vendor.locationId,
        vendorId: vendor.id,
        categoryId: category.id,
        subcategoryId: subcategory.id,
        name: 'Paneer Butter Masala',
        description: 'Creamy tomato-based curry with paneer',
        price: 220,
        isVeg: true,
        isAvailable: true,
        status: 'ACTIVE',
      },
      { upsert: true, new: true },
    );
  }
  void locations;
}

async function seedInstamartCatalog(stores: Awaited<ReturnType<typeof seedStores>>) {
  const category = await InstamartCategory.findOneAndUpdate(
    { name: 'Groceries' },
    { name: 'Groceries', status: 'ACTIVE' },
    { upsert: true, new: true },
  );
  const subcategory = await InstamartSubcategory.findOneAndUpdate(
    { categoryId: category.id, name: 'Staples' },
    { categoryId: category.id, name: 'Staples', status: 'ACTIVE' },
    { upsert: true, new: true },
  );

  for (const store of stores) {
    const product = await InstamartProduct.findOneAndUpdate(
      { storeId: store.id, sku: 'RICE-1KG' },
      {
        locationId: store.locationId,
        storeId: store.id,
        categoryId: category.id,
        subcategoryId: subcategory.id,
        name: 'Basmati Rice 1kg',
        brand: 'Local',
        sku: 'RICE-1KG',
        mrp: 120,
        sellingPrice: 110,
        unit: 'kg',
        packSize: '1kg',
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
        currentStock: 100,
        reservedStock: 0,
        minimumStock: 10,
        maximumStock: 500,
      },
      { upsert: true, new: true },
    );
  }
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
  await seedAdminUsers(locations);
  const vendors = await seedVendors(locations);
  const stores = await seedStores(locations);
  await seedFoodCatalog(locations, vendors);
  await seedInstamartCatalog(stores);
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
