import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { AdminUser } from '../../src/models/AdminUser';
import { Location } from '../../src/models/Location';
import { Customer } from '../../src/models/Customer';
import { hashPassword } from '../../src/utils/password';
import { startTestDatabase, stopTestDatabase } from './testServer';

describe('Customers + Customer Addresses', () => {
  let locationId: string;
  let superAdminToken: string;
  let customerAId: string;
  let customerAToken: string;
  let customerBToken: string;

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();

    const location = await Location.create({
      name: 'Customer City',
      code: 'CUSTCITY',
      state: 'UP',
      district: 'D1',
      latitude: 12,
      longitude: 12,
    });
    locationId = location.id;

    const password = await hashPassword('Password123');
    await AdminUser.create({ name: 'Super', email: 'c.super@example.com', password, role: 'SUPER_ADMIN', locationIds: [] });
    superAdminToken = (
      await request(app).post('/api/v1/auth/admin/login').send({ email: 'c.super@example.com', password: 'Password123' })
    ).body.data.accessToken;

    const customerA = await Customer.create({ name: 'Customer A', phone: '9855500001' });
    customerAId = customerA.id;
    const customerB = await Customer.create({ name: 'Customer B', phone: '9855500002' });

    // Log in as each customer via OTP to get real tokens.
    const otpAndVerify = async (phone: string) => {
      const send = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone });
      const verify = await request(app)
        .post('/api/v1/auth/customer/verify-otp')
        .send({ phone, otp: send.body.data.devOtp });
      return verify.body.data.accessToken;
    };
    customerAToken = await otpAndVerify('9855500001');
    customerBToken = await otpAndVerify('9855500002');
    void customerB;
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  it('lets an admin list and view customers', async () => {
    const res = await request(app).get('/api/v1/customers').set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('lets an admin block a customer, and blocked customers cannot log in again', async () => {
    // Uses a dedicated phone/customer (rather than customerA, who already used
    // send-otp in beforeAll) so this doesn't collide with the OTP resend cooldown.
    const blockedCustomer = await Customer.create({ name: 'Customer C', phone: '9855500003' });

    const res = await request(app)
      .patch(`/api/v1/customers/${blockedCustomer.id}/status`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ status: 'BLOCKED' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('BLOCKED');

    const send = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9855500003' });
    const verify = await request(app)
      .post('/api/v1/auth/customer/verify-otp')
      .send({ phone: '9855500003', otp: send.body.data.devOtp });
    expect(verify.status).toBe(403);
    expect(verify.body.error.code).toBe('CUSTOMER_BLOCKED');
  });

  let addressId: string;

  it('rejects customer B from creating an address for customer A', async () => {
    const res = await request(app)
      .post(`/api/v1/customers/${customerAId}/addresses`)
      .set('Authorization', `Bearer ${customerBToken}`)
      .send({ locationId, address: '123 Main St', pincode: '110001', latitude: 12, longitude: 12 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CUSTOMER_FORBIDDEN');
  });

  it("lets customer A create their own first address, which becomes the default automatically", async () => {
    const res = await request(app)
      .post(`/api/v1/customers/${customerAId}/addresses`)
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ locationId, address: '123 Main St', pincode: '110001', latitude: 12, longitude: 12 });
    expect(res.status).toBe(201);
    expect(res.body.data.isDefault).toBe(true);
    addressId = res.body.data._id;
  });

  let secondAddressId: string;

  it('adding a second address does not auto-default it', async () => {
    const res = await request(app)
      .post(`/api/v1/customers/${customerAId}/addresses`)
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ locationId, address: '456 Side St', pincode: '110002', latitude: 12.1, longitude: 12.1 });
    expect(res.status).toBe(201);
    expect(res.body.data.isDefault).toBe(false);
    secondAddressId = res.body.data._id;
  });

  it('setting the second address as default unsets the first', async () => {
    const res = await request(app)
      .patch(`/api/v1/customers/${customerAId}/addresses/${secondAddressId}/default`)
      .set('Authorization', `Bearer ${customerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.isDefault).toBe(true);

    const firstRes = await request(app)
      .get(`/api/v1/customers/${customerAId}/addresses/${addressId}`)
      .set('Authorization', `Bearer ${customerAToken}`);
    expect(firstRes.body.data.isDefault).toBe(false);
  });

  it('deleting the current default promotes another address to default', async () => {
    const res = await request(app)
      .delete(`/api/v1/customers/${customerAId}/addresses/${secondAddressId}`)
      .set('Authorization', `Bearer ${customerAToken}`);
    expect(res.status).toBe(200);

    const remaining = await request(app)
      .get(`/api/v1/customers/${customerAId}/addresses/${addressId}`)
      .set('Authorization', `Bearer ${customerAToken}`);
    expect(remaining.body.data.isDefault).toBe(true);
  });

  it('rejects customer B from viewing customer A\'s address list', async () => {
    const res = await request(app)
      .get(`/api/v1/customers/${customerAId}/addresses`)
      .set('Authorization', `Bearer ${customerBToken}`);
    expect(res.status).toBe(403);
  });

  it('allows an admin to view customer A\'s addresses for support purposes', async () => {
    const res = await request(app)
      .get(`/api/v1/customers/${customerAId}/addresses`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
  });
});
