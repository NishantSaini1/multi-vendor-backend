import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { Location } from '../../src/models/Location';
import { FoodCategory } from '../../src/models/FoodCategory';
import { startTestDatabase, stopTestDatabase } from './testServer';
import { createTestVendor, createOrderableFoodItem } from './helpers/foodFixtures';

// Customer home browsing: "What's on your mind" only lists categories some
// restaurant in the customer's location actually sells, and the restaurant
// list can be ordered nearest-first from the delivery coordinates.
describe('Customer location-aware browsing', () => {
  let customerToken: string;
  let cityId: string;
  let otherCityId: string;
  let biryaniId: string;
  let pizzaId: string;
  let momosId: string;
  let dessertsId: string;

  const get = (url: string) => request(app).get(`/api/v1${url}`).set('Authorization', `Bearer ${customerToken}`);

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();

    const city = await Location.create({ name: 'Browse City', code: 'BRWSCITY', state: 'UP', district: 'D1', latitude: 26.85, longitude: 80.95 });
    const other = await Location.create({ name: 'Other City', code: 'OTHRCITY', state: 'UP', district: 'D2', latitude: 25.4, longitude: 81.8 });
    cityId = city.id;
    otherCityId = other.id;

    const [biryani, pizza, momos, desserts] = await FoodCategory.create([
      { name: 'Biryani', slug: 'biryani', status: 'ACTIVE' },
      { name: 'Pizza', slug: 'pizza', status: 'ACTIVE' },
      { name: 'Momos', slug: 'momos', status: 'ACTIVE' },
      { name: 'Desserts', slug: 'desserts', status: 'ACTIVE' },
    ]);
    biryaniId = biryani.id;
    pizzaId = pizza.id;
    momosId = momos.id;
    dessertsId = desserts.id;

    const base = { ownerName: 'Owner', password: 'x', address: 'Addr', status: 'ACTIVE', approvalStatus: 'APPROVED' };
    // In the city, at increasing distance from the customer (26.85, 80.95).
    // Near ≈ 0.15 km, Mid ≈ 5.2 km, A Far ≈ 18.6 km — each with a radius that reaches the customer.
    const near = await createTestVendor({ ...base, locationId: cityId, restaurantName: 'Near', phone: '9855500001', latitude: 26.851, longitude: 80.951 });
    const mid = await createTestVendor({ ...base, locationId: cityId, restaurantName: 'Mid', phone: '9855500002', latitude: 26.88, longitude: 80.99, serviceRadius: 10 });
    const far = await createTestVendor({ ...base, locationId: cityId, restaurantName: 'A Far', phone: '9855500003', latitude: 26.95, longitude: 81.1, serviceRadius: 25 });
    // ≈ 2.9 km away but only delivers within 1 km — never listed for this customer.
    const shortRange = await createTestVendor({
      ...base,
      locationId: cityId,
      restaurantName: 'Short Range',
      phone: '9855500006',
      latitude: 26.87,
      longitude: 80.97,
      serviceRadius: 1,
    });
    await createOrderableFoodItem(shortRange.id, dessertsId, { name: 'Rasmalai' });
    // Not visible to customers: pending approval.
    const pending = await createTestVendor({
      ...base,
      approvalStatus: 'PENDING',
      locationId: cityId,
      restaurantName: 'Pending',
      phone: '9855500004',
      latitude: 26.85,
      longitude: 80.95,
    });
    // Another location entirely.
    const elsewhere = await createTestVendor({ ...base, locationId: otherCityId, restaurantName: 'Elsewhere', phone: '9855500005', latitude: 25.4, longitude: 81.8 });

    await createOrderableFoodItem(near.id, biryaniId, { name: 'Chicken Biryani' });
    await createOrderableFoodItem(mid.id, pizzaId, { name: 'Margherita' });
    // An inactive listing doesn't put its category on sale.
    await createOrderableFoodItem(far.id, dessertsId, { name: 'Gulab Jamun', status: 'INACTIVE' });
    await createOrderableFoodItem(pending.id, momosId, { name: 'Veg Momos' });
    await createOrderableFoodItem(elsewhere.id, momosId, { name: 'Paneer Momos' });

    const sendOtp = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9855500050' });
    customerToken = (
      await request(app).post('/api/v1/auth/customer/verify-otp').send({ phone: '9855500050', otp: sendOtp.body.data.devOtp })
    ).body.data.accessToken;
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  it('lists only the categories sold by live restaurants in the location', async () => {
    const res = await get(`/food/categories?locationId=${cityId}`);
    expect(res.status).toBe(200);
    const names = res.body.data.map((c: { name: string }) => c.name).sort();
    // Desserts: Short Range lists Rasmalai (A Far's Gulab Jamun is inactive)
    expect(names).toEqual(['Biryani', 'Desserts', 'Pizza']);
  });

  it("with coordinates, drops categories only sold by restaurants that don't deliver there", async () => {
    const res = await get(`/food/categories?locationId=${cityId}&lat=26.85&lng=80.95`);
    expect(res.body.data.map((c: { name: string }) => c.name).sort()).toEqual(['Biryani', 'Pizza']);
  });

  it('scopes categories to each location separately', async () => {
    const res = await get(`/food/categories?locationId=${otherCityId}`);
    expect(res.body.data.map((c: { name: string }) => c.name)).toEqual(['Momos']);
  });

  it('still lists every active global category without a location', async () => {
    const res = await get('/food/categories');
    expect(res.body.data.map((c: { name: string }) => c.name).sort()).toEqual(['Biryani', 'Desserts', 'Momos', 'Pizza']);
  });

  it("hides restaurants whose service radius doesn't reach the customer", async () => {
    const res = await get(`/vendors?locationId=${cityId}&lat=26.85&lng=80.95`);
    const names = res.body.data.map((v: { restaurantName: string }) => v.restaurantName);
    expect(names).not.toContain('Short Range');
    // a customer inside its 1 km radius does see it
    const close = await get(`/vendors?locationId=${cityId}&lat=26.8705&lng=80.9705`);
    expect(close.body.data.map((v: { restaurantName: string }) => v.restaurantName)).toContain('Short Range');
  });

  it('orders restaurants nearest-first when the customer sends coordinates', async () => {
    const res = await get(`/vendors?locationId=${cityId}&lat=26.85&lng=80.95`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((v: { restaurantName: string }) => v.restaurantName)).toEqual(['Near', 'Mid', 'A Far']);
    expect(res.body.pagination.total).toBe(3);
    // hydrated documents keep the same customer view (no password, `id` set)
    expect(res.body.data[0].password).toBeUndefined();
    expect(typeof res.body.data[0].id).toBe('string');
  });

  it('pages through the distance order', async () => {
    const res = await get(`/vendors?locationId=${cityId}&lat=26.85&lng=80.95&page=2&limit=2`);
    expect(res.body.data.map((v: { restaurantName: string }) => v.restaurantName)).toEqual(['A Far']);
  });

  it('keeps the name order without coordinates', async () => {
    const res = await get(`/vendors?locationId=${cityId}`);
    expect(res.body.data.map((v: { restaurantName: string }) => v.restaurantName)).toEqual(['A Far', 'Mid', 'Near', 'Short Range']);
  });
});
