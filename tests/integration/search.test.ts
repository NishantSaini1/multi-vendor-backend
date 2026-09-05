import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { Location } from '../../src/models/Location';
import { Vendor } from '../../src/models/Vendor';
import { Store } from '../../src/models/Store';
import { FoodCategory } from '../../src/models/FoodCategory';
import { FoodProduct } from '../../src/models/FoodProduct';
import { InstamartCategory } from '../../src/models/InstamartCategory';
import { InstamartProduct } from '../../src/models/InstamartProduct';
import { hashPassword } from '../../src/utils/password';
import { startTestDatabase, stopTestDatabase } from './testServer';

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

    const vendor = await Vendor.create({
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
    await Vendor.create({
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
    await FoodProduct.create({ locationId, vendorId: vendor.id, categoryId: category.id, name: 'Margherita Pizza', isAvailable: true, status: 'ACTIVE', price: 200 });
    await FoodProduct.create({ locationId, vendorId: vendor.id, categoryId: category.id, name: 'Unavailable Pizza', isAvailable: false, status: 'ACTIVE', price: 200 });

    const store = await Store.create({ locationId, name: 'Pizza Mart Grocery', managerName: 'Manager', phone: '9877990020', address: 'Somewhere', latitude: 27, longitude: 27, status: 'ACTIVE' });
    const instamartCategory = await InstamartCategory.create({ name: 'Search Instamart Category', status: 'ACTIVE' });
    await InstamartProduct.create({ locationId, storeId: store.id, categoryId: instamartCategory.id, name: 'Frozen Pizza Base', sku: 'PZB-1', mrp: 100, sellingPrice: 90, unit: 'pc', status: 'ACTIVE' });

    // A same-named vendor in a different location should not show up when
    // searching scoped to `locationId`.
    await Vendor.create({
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
