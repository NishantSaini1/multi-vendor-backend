import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { AdminUser } from '../../src/models/AdminUser';
import { Location } from '../../src/models/Location';
import { Vendor } from '../../src/models/Vendor';
import { hashPassword } from '../../src/utils/password';
import { startTestDatabase, stopTestDatabase } from './testServer';

describe('Commission rules: GLOBAL/LOCATION/VENDOR/STORE scoping and access control', () => {
  let locationA: string;
  let locationB: string;
  let superAdminToken: string;
  let unrestrictedFinanceToken: string;
  let scopedFinanceToken: string; // scoped to locationB only
  let vendorInLocationAId: string;

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();

    const locA = await Location.create({ name: 'Commission City A', code: 'COMMA', state: 'UP', district: 'D1', latitude: 16, longitude: 16 });
    const locB = await Location.create({ name: 'Commission City B', code: 'COMMB', state: 'UP', district: 'D2', latitude: 17, longitude: 17 });
    locationA = locA.id;
    locationB = locB.id;

    const password = await hashPassword('Password123');
    await AdminUser.create({ name: 'Super', email: 'c.super@example.com', password, role: 'SUPER_ADMIN', locationIds: [] });
    await AdminUser.create({ name: 'Finance', email: 'c.finance@example.com', password, role: 'FINANCE_ADMIN', locationIds: [] });
    await AdminUser.create({ name: 'Finance Scoped', email: 'c.financeb@example.com', password, role: 'FINANCE_ADMIN', locationIds: [locationB] });

    superAdminToken = (await request(app).post('/api/v1/auth/admin/login').send({ email: 'c.super@example.com', password: 'Password123' })).body.data.accessToken;
    unrestrictedFinanceToken = (await request(app).post('/api/v1/auth/admin/login').send({ email: 'c.finance@example.com', password: 'Password123' })).body.data.accessToken;
    scopedFinanceToken = (await request(app).post('/api/v1/auth/admin/login').send({ email: 'c.financeb@example.com', password: 'Password123' })).body.data.accessToken;

    const vendor = await Vendor.create({
      locationId: locationA,
      restaurantName: 'Commission Restaurant',
      ownerName: 'Owner',
      phone: '9877500001',
      password: await hashPassword('VendorPass123'),
      address: 'Somewhere',
      latitude: 16,
      longitude: 16,
      status: 'ACTIVE',
      approvalStatus: 'APPROVED',
      isOpen: true,
    });
    vendorInLocationAId = vendor.id;
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  it('rejects a non-super-admin FINANCE_ADMIN from creating a GLOBAL commission', async () => {
    const res = await request(app)
      .post('/api/v1/commissions')
      .set('Authorization', `Bearer ${unrestrictedFinanceToken}`)
      .send({ level: 'GLOBAL', type: 'PERCENTAGE', value: 10 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GLOBAL_COMMISSION_FORBIDDEN');
  });

  it('lets a SUPER_ADMIN create a GLOBAL commission', async () => {
    const res = await request(app)
      .post('/api/v1/commissions')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ level: 'GLOBAL', type: 'PERCENTAGE', value: 10 });
    expect(res.status).toBe(201);
    expect(res.body.data.level).toBe('GLOBAL');
  });

  it('rejects a mismatched level/scope combination', async () => {
    const res = await request(app)
      .post('/api/v1/commissions')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ level: 'GLOBAL', locationId: locationA, type: 'PERCENTAGE', value: 5 });
    expect(res.status).toBe(422);
  });

  it('rejects a VENDOR-level commission for a vendor that does not exist', async () => {
    const res = await request(app)
      .post('/api/v1/commissions')
      .set('Authorization', `Bearer ${unrestrictedFinanceToken}`)
      .send({ level: 'VENDOR', vendorId: '507f1f77bcf86cd799439011', type: 'PERCENTAGE', value: 15 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('VENDOR_NOT_FOUND');
  });

  it("rejects a FINANCE_ADMIN scoped to locationB from creating a VENDOR-level commission for a vendor in locationA", async () => {
    const res = await request(app)
      .post('/api/v1/commissions')
      .set('Authorization', `Bearer ${scopedFinanceToken}`)
      .send({ level: 'VENDOR', vendorId: vendorInLocationAId, type: 'PERCENTAGE', value: 20 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('LOCATION_FORBIDDEN');
  });

  let vendorCommissionId: string;

  it('lets an unrestricted FINANCE_ADMIN create a VENDOR-level commission, inheriting the location from the vendor', async () => {
    const res = await request(app)
      .post('/api/v1/commissions')
      .set('Authorization', `Bearer ${unrestrictedFinanceToken}`)
      .send({ level: 'VENDOR', vendorId: vendorInLocationAId, businessType: 'FOOD', type: 'PERCENTAGE', value: 20 });
    expect(res.status).toBe(201);
    vendorCommissionId = res.body.data._id;
  });

  it("rejects the locationB-scoped admin from reading that vendor's commission rule", async () => {
    const res = await request(app)
      .get(`/api/v1/commissions/${vendorCommissionId}`)
      .set('Authorization', `Bearer ${scopedFinanceToken}`);
    expect(res.status).toBe(403);
  });

  it('lets the unrestricted admin update the value and status of the vendor commission', async () => {
    const update = await request(app)
      .patch(`/api/v1/commissions/${vendorCommissionId}`)
      .set('Authorization', `Bearer ${unrestrictedFinanceToken}`)
      .send({ value: 25 });
    expect(update.status).toBe(200);
    expect(update.body.data.value).toBe(25);

    const statusRes = await request(app)
      .patch(`/api/v1/commissions/${vendorCommissionId}/status`)
      .set('Authorization', `Bearer ${unrestrictedFinanceToken}`)
      .send({ status: 'INACTIVE' });
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.data.status).toBe('INACTIVE');
  });

  it('deletes the vendor commission rule', async () => {
    const res = await request(app)
      .delete(`/api/v1/commissions/${vendorCommissionId}`)
      .set('Authorization', `Bearer ${unrestrictedFinanceToken}`);
    expect(res.status).toBe(200);

    const getRes = await request(app)
      .get(`/api/v1/commissions/${vendorCommissionId}`)
      .set('Authorization', `Bearer ${unrestrictedFinanceToken}`);
    expect(getRes.status).toBe(404);
  });
});
