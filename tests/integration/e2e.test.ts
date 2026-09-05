import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../../src/app';
import { env } from '../../src/config/env';
import { redisClient } from '../../src/config/redis';
import { AdminUser } from '../../src/models/AdminUser';
import { Location } from '../../src/models/Location';
import { DeliveryZone } from '../../src/models/DeliveryZone';
import { Vendor } from '../../src/models/Vendor';
import { FoodCategory } from '../../src/models/FoodCategory';
import { FoodProduct } from '../../src/models/FoodProduct';
import { hashPassword } from '../../src/utils/password';
import { startTestDatabase, stopTestDatabase } from './testServer';

// Dedicated cross-cutting E2E coverage — the scenarios named in the
// project's own roadmap that don't belong to any single module's test file:
// OTP brute force, expired/invalid/forged tokens, cross-location data
// leakage through *list* endpoints (as opposed to the single-resource 403s
// already covered per-module), and an explicit confirmation that a client
// cannot influence an order's price by sending price fields it was never
// asked for. Insufficient-inventory and single-resource cross-vendor/
// cross-location 403s already have solid coverage in order.test.ts,
// storeInstamartInventory.test.ts, foodCatalog.test.ts, and
// locationAuthorization.test.ts — deliberately not duplicated here.
describe('Cross-cutting E2E: OTP brute force, token forgery/expiry, cross-location list scoping, order total integrity', () => {
  let locationA: string;
  let locationB: string;
  let scopedAdminToken: string; // LOCATION_ADMIN scoped to locationA only
  let vendorAId: string;
  let vendorBId: string;
  let vendorAToken: string;
  let vendorBToken: string;
  let productAId: string;
  let addonBId: string;
  let customerToken: string;
  let addressAId: string;

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();

    const locA = await Location.create({ name: 'E2E Location A', code: 'E2EA', state: 'UP', district: 'D1', latitude: 30, longitude: 30, serviceRadius: 20 });
    const locB = await Location.create({ name: 'E2E Location B', code: 'E2EB', state: 'UP', district: 'D2', latitude: 31, longitude: 31, serviceRadius: 20 });
    locationA = locA.id;
    locationB = locB.id;

    await DeliveryZone.create({
      locationId: locationA,
      name: 'E2E Zone A',
      centerLatitude: 30,
      centerLongitude: 30,
      radius: 15,
      deliveryFee: 25,
      freeDeliveryAbove: 1000,
      estimatedDeliveryTime: 30,
      status: 'ACTIVE',
    });

    const password = await hashPassword('Password123');
    await AdminUser.create({ name: 'Scoped Admin', email: 'e2e.scoped@example.com', password, role: 'LOCATION_ADMIN', locationIds: [locationA] });
    scopedAdminToken = (await request(app).post('/api/v1/auth/admin/login').send({ email: 'e2e.scoped@example.com', password: 'Password123' })).body.data.accessToken;

    const vendorA = await Vendor.create({
      locationId: locationA,
      restaurantName: 'E2E Vendor A',
      ownerName: 'Owner A',
      phone: '9877700301',
      password: await hashPassword('VendorPass123'),
      address: 'Somewhere',
      latitude: 30,
      longitude: 30,
      status: 'ACTIVE',
      approvalStatus: 'APPROVED',
      isOpen: true,
    });
    vendorAId = vendorA.id;
    vendorAToken = (await request(app).post('/api/v1/auth/vendor/login').send({ identifier: '9877700301', password: 'VendorPass123' })).body.data.accessToken;

    const vendorB = await Vendor.create({
      locationId: locationB,
      restaurantName: 'E2E Vendor B',
      ownerName: 'Owner B',
      phone: '9877700302',
      password: await hashPassword('VendorPass123'),
      address: 'Elsewhere',
      latitude: 31,
      longitude: 31,
      status: 'ACTIVE',
      approvalStatus: 'APPROVED',
      isOpen: true,
    });
    vendorBId = vendorB.id;
    vendorBToken = (await request(app).post('/api/v1/auth/vendor/login').send({ identifier: '9877700302', password: 'VendorPass123' })).body.data.accessToken;

    const category = await FoodCategory.create({ name: 'E2E Food Category', status: 'ACTIVE' });
    const productA = await FoodProduct.create({ locationId: locationA, vendorId: vendorAId, categoryId: category.id, name: 'E2E Item A', price: 120, discount: 0, tax: 0, isAvailable: true, status: 'ACTIVE' });
    productAId = productA.id;

    const addonBRes = await request(app)
      .post('/api/v1/food/addons')
      .set('Authorization', `Bearer ${vendorBToken}`)
      .send({ name: 'E2E Addon B', price: 10, maxQuantity: 3 });
    addonBId = addonBRes.body.data._id;

    const sendOtp = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9877700350' });
    const verify = await request(app).post('/api/v1/auth/customer/verify-otp').send({ phone: '9877700350', otp: sendOtp.body.data.devOtp });
    customerToken = verify.body.data.accessToken;
    const customerId = verify.body.data.customer._id;

    const addressRes = await request(app)
      .post(`/api/v1/customers/${customerId}/addresses`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ locationId: locationA, address: '1 E2E Lane', pincode: '110077', latitude: 30, longitude: 30 });
    addressAId = addressRes.body.data._id;
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  describe('OTP brute force', () => {
    it('locks out after OTP_MAX_ATTEMPTS wrong guesses, invalidating even the real OTP afterward', async () => {
      const phone = '9877700399';
      const sendOtp = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone });
      const realOtp = sendOtp.body.data.devOtp as string;
      const wrongOtp = realOtp === '111111' ? '222222' : '111111';

      for (let i = 0; i < env.OTP_MAX_ATTEMPTS; i += 1) {
        const res = await request(app).post('/api/v1/auth/customer/verify-otp').send({ phone, otp: wrongOtp });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('OTP_INVALID');
      }

      const lockedOut = await request(app).post('/api/v1/auth/customer/verify-otp').send({ phone, otp: wrongOtp });
      expect(lockedOut.status).toBe(429);
      expect(lockedOut.body.error.code).toBe('OTP_MAX_ATTEMPTS');

      // Even the genuinely correct OTP is rejected now — the record was purged on lockout.
      const withRealOtp = await request(app).post('/api/v1/auth/customer/verify-otp').send({ phone, otp: realOtp });
      expect(withRealOtp.status).toBe(400);
      expect(withRealOtp.body.error.code).toBe('OTP_EXPIRED');
    });
  });

  describe('Expired, malformed, and forged tokens', () => {
    it('rejects a malformed token', async () => {
      const res = await request(app).get('/api/v1/orders').set('Authorization', 'Bearer not-a-real-token');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TOKEN_INVALID');
    });

    it('rejects a token forged with the wrong secret', async () => {
      const forged = jwt.sign({ userId: '507f1f77bcf86cd799439011', userType: 'ADMIN', role: 'SUPER_ADMIN', locationIds: [] }, 'not-the-real-secret', { expiresIn: '1h' });
      const res = await request(app).get('/api/v1/admin-users').set('Authorization', `Bearer ${forged}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TOKEN_INVALID');
    });

    it('rejects a genuinely expired token, even with a correctly-signed payload', async () => {
      const expired = jwt.sign({ userId: '507f1f77bcf86cd799439011', userType: 'CUSTOMER', role: 'CUSTOMER', locationIds: [] }, env.JWT_SECRET, { expiresIn: '-10s' });
      const res = await request(app).get('/api/v1/orders').set('Authorization', `Bearer ${expired}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TOKEN_INVALID');
    });

    it('rejects a request with no token at all', async () => {
      const res = await request(app).get('/api/v1/orders');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TOKEN_MISSING');
    });
  });

  describe('Cross-location data leakage through list endpoints', () => {
    it("never leaks another location's vendors through a LOCATION_ADMIN's vendor list", async () => {
      const res = await request(app).get('/api/v1/vendors').set('Authorization', `Bearer ${scopedAdminToken}`);
      expect(res.status).toBe(200);
      const ids = res.body.data.map((v: { _id: string }) => v._id);
      expect(ids).toContain(vendorAId);
      expect(ids).not.toContain(vendorBId);
    });

    it("never leaks another location's orders through a LOCATION_ADMIN's order list", async () => {
      await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ businessType: 'FOOD', vendorId: vendorAId, addressId: addressAId, paymentMethod: 'COD', items: [{ productId: productAId, quantity: 1, addons: [] }] });

      const res = await request(app).get('/api/v1/orders').set('Authorization', `Bearer ${scopedAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.every((o: { locationId: string }) => o.locationId === locationA)).toBe(true);
    });
  });

  describe('Cross-vendor authorization', () => {
    it("rejects a vendor updating another vendor's addon by guessing its id", async () => {
      const res = await request(app)
        .patch(`/api/v1/food/addons/${addonBId}`)
        .set('Authorization', `Bearer ${vendorAToken}`)
        .send({ price: 1 });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('OWNER_FORBIDDEN');
    });
  });

  describe('Order total integrity', () => {
    it("ignores client-supplied price fields entirely, computing the total from server-side catalog data", async () => {
      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        // Deliberately sending price fields the create schema doesn't
        // declare, to prove the server ignores them entirely.
        .send({
          businessType: 'FOOD',
          vendorId: vendorAId,
          addressId: addressAId,
          paymentMethod: 'COD',
          items: [{ productId: productAId, quantity: 1, addons: [] }],
          subtotal: 1,
          discount: 999,
          tax: 0,
          deliveryFee: 0,
          total: 1,
        });
      expect(res.status).toBe(201);
      // subtotal=120 (server price), deliveryFee=25 (zone), total = 120 + 25 = 145 — none of the spoofed values above.
      expect(res.body.data.subtotal).toBe(120);
      expect(res.body.data.total).toBe(145);
    });
  });
});
