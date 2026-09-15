import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { Location } from '../../src/models/Location';
import { FoodCategory } from '../../src/models/FoodCategory';
import { InstamartCategory } from '../../src/models/InstamartCategory';
import { hashPassword } from '../../src/utils/password';
import { startTestDatabase, stopTestDatabase } from './testServer';
import { createTestVendor, createOrderableFoodItem, createTestStore, createInstamartListing } from './helpers/foodFixtures';

describe('Search: cross-collection text search over vendors/products/stores', () => {
  let locationId: string;
  let otherLocationId: string;

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();

    const location = await Location.create({ name: 'Search City', code: 'SEARCHCITY', state: 'UP', district: 'D1', latitude: 27, longitude: 27 });
    locationId = location.id;
    const otherLocation = await Location.create({ name: 'Other Search City', code: 'OTHERSEARCH', state: 'UP', district: 'D2', latitude: 28, longitude: 28 });
    otherLocationId = otherLocation.id;

    const vendor = await createTestVendor({
      locationId,
      restaurantName: 'Pizza Palace',
      ownerName: 'Owner',
      phone: '9877990010',
      password: await hashPassword('VendorPass123'),
      address: 'Somewhere',
      latitude: 27,
      longitude: 27,
      status: 'ACTIVE',
      approvalStatus: 'APPROVED',
      isOpen: true,
    });
    await createTestVendor({
      locationId,
      restaurantName: 'Pizza Unapproved',
      ownerName: 'Owner',
      phone: '9877990011',
      password: await hashPassword('VendorPass123'),
      address: 'Somewhere',
      latitude: 27,
      longitude: 27,
      status: 'ACTIVE',
      approvalStatus: 'PENDING',
      isOpen: true,
    });

    const category = await FoodCategory.create({ name: 'Search Food Category', status: 'ACTIVE' });
    // search.service.ts matches the GLOBAL FoodProduct by text search, then
    // joins each vendor's VendorFoodItem listing filtered by the listing's
    // own `status` (GENERIC_STATUS) — NOT by `availabilityStatus`, which the
    // search join never looks at. So to keep "Unavailable Pizza" out of the
    // search results (the actual behavior under test), its VendorFoodItem
    // listing must be `status: 'INACTIVE'` (a delisted item); `availabilityStatus:
    // 'OUT_OF_STOCK'` is set alongside it to reflect the old isAvailable:false
    // intent, but status is what search actually filters on.
    await createOrderableFoodItem(vendor.id, category.id, { name: 'Margherita Pizza', price: 200 });
    await createOrderableFoodItem(vendor.id, category.id, {
      name: 'Unavailable Pizza',
      price: 200,
      availabilityStatus: 'OUT_OF_STOCK',
      status: 'INACTIVE',
    });

    const store = await createTestStore({ locationId, name: 'Pizza Mart Grocery', managerName: 'Manager', phone: '9877990020', address: 'Somewhere', latitude: 27, longitude: 27, status: 'ACTIVE' });
    const instamartCategory = await InstamartCategory.create({ name: 'Search Instamart Category', status: 'ACTIVE' });
    await createInstamartListing(locationId, store.id, instamartCategory.id, { name: 'Frozen Pizza Base', sku: 'PZB-1', mrp: 100, sellingPrice: 90, unit: 'pc' });

    // A same-named vendor in a different location should not show up when
    // searching scoped to `locationId`.
    await createTestVendor({
      locationId: otherLocationId,
      restaurantName: 'Pizza Elsewhere',
      ownerName: 'Owner',
      phone: '9877990012',
      password: await hashPassword('VendorPass123'),
      address: 'Elsewhere',
      latitude: 28,
      longitude: 28,
      status: 'ACTIVE',
      approvalStatus: 'APPROVED',
      isOpen: true,
    });
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  it('is public — no auth required', async () => {
    const res = await request(app).get('/api/v1/search').query({ q: 'pizza' });
    expect(res.status).toBe(200);
  });

  it('finds vendors, food products, and instamart products matching the query', async () => {
    const res = await request(app).get('/api/v1/search').query({ q: 'pizza' });
    expect(res.body.data.vendors.some((v: { restaurantName: string }) => v.restaurantName === 'Pizza Palace')).toBe(true);
    expect(res.body.data.foodProducts.some((p: { name: string }) => p.name === 'Margherita Pizza')).toBe(true);
    expect(res.body.data.stores.some((s: { name: string }) => s.name === 'Pizza Mart Grocery')).toBe(true);
    expect(res.body.data.instamartProducts.some((p: { name: string }) => p.name === 'Frozen Pizza Base')).toBe(true);
  });

  it('excludes an unapproved vendor and an unavailable product', async () => {
    const res = await request(app).get('/api/v1/search').query({ q: 'pizza' });
    expect(res.body.data.vendors.some((v: { restaurantName: string }) => v.restaurantName === 'Pizza Unapproved')).toBe(false);
    expect(res.body.data.foodProducts.some((p: { name: string }) => p.name === 'Unavailable Pizza')).toBe(false);
  });

  it('scopes results to the given locationId', async () => {
    const res = await request(app).get('/api/v1/search').query({ q: 'pizza', locationId });
    expect(res.body.data.vendors.some((v: { restaurantName: string }) => v.restaurantName === 'Pizza Elsewhere')).toBe(false);

    const otherRes = await request(app).get('/api/v1/search').query({ q: 'pizza', locationId: otherLocationId });
    expect(otherRes.body.data.vendors.some((v: { restaurantName: string }) => v.restaurantName === 'Pizza Elsewhere')).toBe(true);
    expect(otherRes.body.data.vendors.some((v: { restaurantName: string }) => v.restaurantName === 'Pizza Palace')).toBe(false);
  });

  it('scopes results by businessType', async () => {
    const res = await request(app).get('/api/v1/search').query({ q: 'pizza', businessType: 'INSTAMART' });
    expect(res.body.data.vendors).toHaveLength(0);
    expect(res.body.data.foodProducts).toHaveLength(0);
    expect(res.body.data.instamartProducts.length).toBeGreaterThan(0);
  });

  it('rejects a query that is too short', async () => {
    const res = await request(app).get('/api/v1/search').query({ q: 'p' });
    expect(res.status).toBe(422);
  });
});
