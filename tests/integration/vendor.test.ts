import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { AdminUser } from '../../src/models/AdminUser';
import { Location } from '../../src/models/Location';
import { hashPassword } from '../../src/utils/password';
import { startTestDatabase, stopTestDatabase } from './testServer';

describe('Vendor admin module', () => {
  let locationA: string;
  let locationB: string;
  let superAdminToken: string;
  let locationAdminToken: string; // scoped to locationA only
  let foodAdminToken: string; // role-scoped, no locationIds restriction

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();

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
});
