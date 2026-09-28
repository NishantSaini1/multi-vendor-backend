import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { Location } from '../../src/models/Location';
import { DeliveryZone } from '../../src/models/DeliveryZone';
import { InstamartCategory } from '../../src/models/InstamartCategory';
import { Inventory } from '../../src/models/Inventory';
import { startTestDatabase, stopTestDatabase } from './testServer';
import { createTestStore, createInstamartListing } from './helpers/foodFixtures';

// A store's own serviceRadius (like a Vendor's): customers beyond it don't
// see the store or its products, and can't order from it.
describe('Store service radius', () => {
  let customerToken: string;
  let locationId: string;
  let addressId: string;
  let farProductId: string;
  let nearProductId: string;
  let farStoreId: string;
  let nearStoreId: string;

  const get = (url: string) => request(app).get(`/api/v1${url}`).set('Authorization', `Bearer ${customerToken}`);

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();

    const location = await Location.create({ name: 'Radius City', code: 'RADCITY', state: 'UP', district: 'D1', latitude: 15, longitude: 15, serviceRadius: 50 });
    locationId = location.id;
    const zone = await DeliveryZone.create({
      locationId,
      name: 'Whole City',
      centerLatitude: 15,
      centerLongitude: 15,
      radius: 50,
      deliveryFee: 20,
      freeDeliveryAbove: 500,
      estimatedDeliveryTime: 30,
      status: 'ACTIVE',
    });

    const base = { locationId, deliveryZoneId: zone.id, managerName: 'Manager', address: 'Addr', status: 'ACTIVE' };
    // Customer sits at (15, 15).
    const near = await createTestStore({ ...base, name: 'Near Mart', phone: '9866600001', latitude: 15.001, longitude: 15.001 }); // ≈0.15 km, default 5 km
    const wide = await createTestStore({ ...base, name: 'Wide Mart', phone: '9866600002', latitude: 15.1, longitude: 15.0, serviceRadius: 20 }); // ≈11 km
    const far = await createTestStore({ ...base, name: 'Far Mart', phone: '9866600003', latitude: 15.1, longitude: 15.1 }); // ≈15.6 km, default 5 km
    nearStoreId = near.id;
    farStoreId = far.id;

    const category = await InstamartCategory.create({ name: 'Radius Staples', status: 'ACTIVE' });
    nearProductId = (await createInstamartListing(locationId, near.id, category.id, { name: 'Near Rice', sku: 'R-NEAR', unit: 'kg', mrp: 100 })).id;
    await createInstamartListing(locationId, wide.id, category.id, { name: 'Wide Rice', sku: 'R-WIDE', unit: 'kg', mrp: 100 });
    farProductId = (await createInstamartListing(locationId, far.id, category.id, { name: 'Far Rice', sku: 'R-FAR', unit: 'kg', mrp: 100 })).id;
    await Inventory.create({ locationId, storeId: near.id, productId: nearProductId, currentStock: 10, reservedStock: 0 });
    await Inventory.create({ locationId, storeId: far.id, productId: farProductId, currentStock: 10, reservedStock: 0 });

    const sendOtp = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9866600050' });
    const verify = await request(app).post('/api/v1/auth/customer/verify-otp').send({ phone: '9866600050', otp: sendOtp.body.data.devOtp });
    customerToken = verify.body.data.accessToken;
    const addressRes = await request(app)
      .post(`/api/v1/customers/${verify.body.data.customer._id}/addresses`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ locationId, address: '1 Radius Road', pincode: '110077', latitude: 15, longitude: 15 });
    addressId = addressRes.body.data._id;
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  it('lists only stores whose radius reaches the customer, nearest first', async () => {
    const res = await get(`/stores?locationId=${locationId}&lat=15&lng=15`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((s: { name: string }) => s.name)).toEqual(['Near Mart', 'Wide Mart']);
    expect(res.body.pagination.total).toBe(2);
    expect(res.body.data[0].serviceRadius).toBe(5);
  });

  it('lists every store in the location without coordinates', async () => {
    const res = await get(`/stores?locationId=${locationId}`);
    expect(res.body.data).toHaveLength(3);
  });

  it('only returns products from stores that deliver to the customer', async () => {
    const res = await get(`/instamart/products?locationId=${locationId}&lat=15&lng=15&status=ACTIVE`);
    expect(res.status).toBe(200);
    const names = res.body.data.map((p: { name: string }) => p.name).sort();
    expect(names).toEqual(['Near Rice', 'Wide Rice']);
  });

  it('reports an out-of-range store as not serviceable', async () => {
    const check = (storeId: string) =>
      request(app)
        .post('/api/v1/serviceability/check')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ latitude: 15, longitude: 15, businessType: 'INSTAMART', storeId });
    const far = await check(farStoreId);
    expect(far.body.data.serviceable).toBe(false);
    expect(far.body.data.reason).toBe('OUT_OF_SELLER_RANGE');
    expect(far.body.data.sellerServiceRadiusKm).toBe(5);
    const near = await check(nearStoreId);
    expect(near.body.data.serviceable).toBe(true);
  });

  it('rejects an order from a store that does not deliver to the address', async () => {
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ businessType: 'INSTAMART', storeId: farStoreId, addressId, paymentMethod: 'COD', items: [{ productId: farProductId, quantity: 1, modifiers: [] }] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('OUT_OF_SELLER_RANGE');
  });

  it('accepts an order from a store in range', async () => {
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ businessType: 'INSTAMART', storeId: nearStoreId, addressId, paymentMethod: 'COD', items: [{ productId: nearProductId, quantity: 1, modifiers: [] }] });
    expect(res.status).toBe(201);
  });
});
