import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { AdminUser } from '../../src/models/AdminUser';
import { Location } from '../../src/models/Location';
import { hashPassword } from '../../src/utils/password';
import { startTestDatabase, stopTestDatabase } from './testServer';
import { createTestVendorType, createOrderableFoodItem } from './helpers/foodFixtures';
import { FoodCategory } from '../../src/models/FoodCategory';

describe('Vendor admin module', () => {
  let locationA: string;
  let locationB: string;
  let superAdminToken: string;
  let locationAdminToken: string; // scoped to locationA only
  let foodAdminToken: string; // role-scoped, no locationIds restriction
  let vendorTypeId: string;

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();

    const vendorType = await createTestVendorType();
    vendorTypeId = vendorType.id;

    const locA = await Location.create({
      name: 'Location A',
      code: 'VLOCA',
      state: 'UP',
      district: 'D1',
      latitude: 1,
      longitude: 1,
    });
    const locB = await Location.create({
      name: 'Location B',
      code: 'VLOCB',
      state: 'UP',
      district: 'D2',
      latitude: 2,
      longitude: 2,
    });
    locationA = locA.id;
    locationB = locB.id;

    const password = await hashPassword('Password123');
    await AdminUser.create({ name: 'Super', email: 'v.super@example.com', password, role: 'SUPER_ADMIN', locationIds: [] });
    await AdminUser.create({
      name: 'Loc Admin',
      email: 'v.locadmin@example.com',
      password,
      role: 'LOCATION_ADMIN',
      locationIds: [locationA],
    });
    await AdminUser.create({
      name: 'Food Admin',
      email: 'v.foodadmin@example.com',
      password,
      role: 'FOOD_ADMIN',
      locationIds: [],
    });

    const login = async (email: string) =>
      (await request(app).post('/api/v1/auth/admin/login').send({ email, password: 'Password123' })).body.data
        .accessToken;

    superAdminToken = await login('v.super@example.com');
    locationAdminToken = await login('v.locadmin@example.com');
    foodAdminToken = await login('v.foodadmin@example.com');
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  const vendorPayload = (locationId: string, phone: string) => ({
    locationId,
    restaurantName: 'Test Restaurant',
    ownerName: 'Owner Name',
    phone,
    password: 'VendorPass123',
    address: '123 Test Street',
    latitude: 1,
    longitude: 1,
    vendorTypeIds: [vendorTypeId],
  });

  it('rejects vendor creation for a location the admin cannot access', async () => {
    const res = await request(app)
      .post('/api/v1/vendors')
      .set('Authorization', `Bearer ${locationAdminToken}`)
      .send(vendorPayload(locationB, '9811100001'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('LOCATION_FORBIDDEN');
  });

  it('rejects vendor creation for a nonexistent location', async () => {
    const res = await request(app)
      .post('/api/v1/vendors')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send(vendorPayload('507f1f77bcf86cd799439099', '9811100002'));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('LOCATION_NOT_FOUND');
  });

  let vendorId: string;

  it('allows a LOCATION_ADMIN to create a vendor within their own location', async () => {
    const res = await request(app)
      .post('/api/v1/vendors')
      .set('Authorization', `Bearer ${locationAdminToken}`)
      .send(vendorPayload(locationA, '9811100003'));
    expect(res.status).toBe(201);
    expect(res.body.data.password).toBeUndefined();
    expect(res.body.data.approvalStatus).toBe('PENDING');
    vendorId = res.body.data._id;
  });

  it('lets the created vendor log in with the password it was created with', async () => {
    const res = await request(app)
      .post('/api/v1/auth/vendor/login')
      .send({ identifier: '9811100003', password: 'VendorPass123' });
    expect(res.status).toBe(200);
    expect(res.body.data.vendor.password).toBeUndefined();
  });

  it('allows a role-scoped FOOD_ADMIN (empty locationIds) to view a vendor in any location', async () => {
    const res = await request(app).get(`/api/v1/vendors/${vendorId}`).set('Authorization', `Bearer ${foodAdminToken}`);
    expect(res.status).toBe(200);
  });

  it("forbids a LOCATION_ADMIN scoped elsewhere from viewing this vendor once its location differs", async () => {
    // Create a second location-scoped admin restricted to locationB only.
    const password = await hashPassword('Password123');
    await AdminUser.create({
      name: 'Loc Admin B',
      email: 'v.locadminb@example.com',
      password,
      role: 'LOCATION_ADMIN',
      locationIds: [locationB],
    });
    const login = await request(app)
      .post('/api/v1/auth/admin/login')
      .send({ email: 'v.locadminb@example.com', password: 'Password123' });
    const tokenB = login.body.data.accessToken;

    const res = await request(app).get(`/api/v1/vendors/${vendorId}`).set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(403);
  });

  it('approves a vendor and flips its status to ACTIVE', async () => {
    const res = await request(app)
      .post(`/api/v1/vendors/${vendorId}/approve`)
      .set('Authorization', `Bearer ${foodAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.approvalStatus).toBe('APPROVED');
    expect(res.body.data.status).toBe('ACTIVE');
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/api/v1/vendors');
    expect(res.status).toBe(401);
  });

  describe('GET /vendors/:id/products', () => {
    let categoryId: string;
    let availableItemId: string;
    let outOfStockItemId: string;
    let customerToken: string;

    beforeAll(async () => {
      const category = await FoodCategory.create({ name: 'Menu Test Category' });
      categoryId = category.id;

      const available = await createOrderableFoodItem(vendorId, categoryId, {
        name: 'Tikki Burger',
        price: 80,
        availabilityStatus: 'AVAILABLE',
        status: 'ACTIVE',
      });
      availableItemId = available.id;

      const outOfStock = await createOrderableFoodItem(vendorId, categoryId, {
        name: 'Paneer Burger',
        price: 90,
        availabilityStatus: 'OUT_OF_STOCK',
        status: 'ACTIVE',
      });
      outOfStockItemId = outOfStock.id;

      const sendOtp = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9811100050' });
      const verify = await request(app)
        .post('/api/v1/auth/customer/verify-otp')
        .send({ phone: '9811100050', otp: sendOtp.body.data.devOtp });
      customerToken = verify.body.data.accessToken;
    });

    it('returns every listing with the global item populated for the vendor/admin', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${vendorId}/products`)
        .set('Authorization', `Bearer ${foodAdminToken}`);
      expect(res.status).toBe(200);
      const ids = res.body.data.map((item: { _id: string }) => item._id);
      expect(ids).toEqual(expect.arrayContaining([availableItemId, outOfStockItemId]));
      const item = res.body.data.find((i: { _id: string }) => i._id === availableItemId);
      expect(item.globalFoodItemId.name).toBe('Tikki Burger');
    });

    it('hides out-of-stock/inactive listings from a customer but still populates the global item', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${vendorId}/products`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(200);
      const ids = res.body.data.map((item: { _id: string }) => item._id);
      expect(ids).toContain(availableItemId);
      expect(ids).not.toContain(outOfStockItemId);
      const item = res.body.data.find((i: { _id: string }) => i._id === availableItemId);
      expect(item.globalFoodItemId.name).toBe('Tikki Burger');
      expect(item.globalFoodItemId.foodType).toBe('VEG');
    });

    describe('a customer viewing one item detail (variants, modifier groups)', () => {
      let variantId: string;
      let modifierGroupId: string;

      beforeAll(async () => {
        const variantRes = await request(app)
          .post(`/api/v1/vendors/${vendorId}/food-items/${availableItemId}/variants`)
          .set('Authorization', `Bearer ${foodAdminToken}`)
          .send({ name: 'Large', price: 120 });
        variantId = variantRes.body.data._id;

        const groupRes = await request(app)
          .post(`/api/v1/vendors/${vendorId}/food-items/${availableItemId}/modifier-groups`)
          .set('Authorization', `Bearer ${foodAdminToken}`)
          .send({ name: 'Choose Sauce', minSelection: 1, maxSelection: 1, required: true });
        modifierGroupId = groupRes.body.data._id;

        await request(app)
          .post(`/api/v1/vendors/${vendorId}/food-items/${availableItemId}/modifier-groups/${modifierGroupId}/options`)
          .set('Authorization', `Bearer ${foodAdminToken}`)
          .send({ name: 'Extra Cheese', price: 20 });
      });

      it('lets a customer fetch the item itself, its variants, and its modifier groups/options', async () => {
        const itemRes = await request(app)
          .get(`/api/v1/vendors/${vendorId}/food-items/${availableItemId}`)
          .set('Authorization', `Bearer ${customerToken}`);
        expect(itemRes.status).toBe(200);
        expect(itemRes.body.data.globalFoodItemId.name).toBe('Tikki Burger');

        const variantsRes = await request(app)
          .get(`/api/v1/vendors/${vendorId}/food-items/${availableItemId}/variants`)
          .set('Authorization', `Bearer ${customerToken}`);
        expect(variantsRes.status).toBe(200);
        expect(variantsRes.body.data.map((v: { _id: string }) => v._id)).toContain(variantId);

        const groupsRes = await request(app)
          .get(`/api/v1/vendors/${vendorId}/food-items/${availableItemId}/modifier-groups`)
          .set('Authorization', `Bearer ${customerToken}`);
        expect(groupsRes.status).toBe(200);
        expect(groupsRes.body.data).toHaveLength(1);
        expect(groupsRes.body.data[0].name).toBe('Choose Sauce');

        const optionsRes = await request(app)
          .get(`/api/v1/vendors/${vendorId}/food-items/${availableItemId}/modifier-groups/${modifierGroupId}/options`)
          .set('Authorization', `Bearer ${customerToken}`);
        expect(optionsRes.status).toBe(200);
        expect(optionsRes.body.data[0].name).toBe('Extra Cheese');
      });

      it('still rejects a customer trying to create a variant (read-only access)', async () => {
        const res = await request(app)
          .post(`/api/v1/vendors/${vendorId}/food-items/${availableItemId}/variants`)
          .set('Authorization', `Bearer ${customerToken}`)
          .send({ name: 'Small', price: 60 });
        expect(res.status).toBe(403);
      });
    });
  });
});
