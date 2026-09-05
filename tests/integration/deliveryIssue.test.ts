import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { AdminUser } from '../../src/models/AdminUser';
import { Location } from '../../src/models/Location';
import { DeliveryZone } from '../../src/models/DeliveryZone';
import { Vendor } from '../../src/models/Vendor';
import { FoodCategory } from '../../src/models/FoodCategory';
import { FoodProduct } from '../../src/models/FoodProduct';
import { hashPassword } from '../../src/utils/password';
import { startTestDatabase, stopTestDatabase } from './testServer';

describe('Delivery issues: raising, cross-party visibility, and admin resolution', () => {
  let locationId: string;
  let superAdminToken: string;
  let deliveryAdminToken: string;
  let foodAdminToken: string; // no DELIVERY_ISSUE_MANAGE
  let customerToken: string;
  let vendorToken: string;
  let vendorId: string;
  let productId: string;
  let addressId: string;

  async function createOnlinePartner(phone: string) {
    const created = await request(app)
      .post('/api/v1/delivery-partners')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ locationId, name: `Partner ${phone}`, phone, password: 'RiderPass123' });
    const partnerId = created.body.data._id;
    await request(app).post(`/api/v1/delivery-partners/${partnerId}/approve`).set('Authorization', `Bearer ${superAdminToken}`);
    const login = await request(app).post('/api/v1/auth/delivery/login').send({ phone, password: 'RiderPass123' });
    const token = login.body.data.accessToken;
    await request(app).post(`/api/v1/delivery-partners/${partnerId}/location`).set('Authorization', `Bearer ${token}`).send({ latitude: 26, longitude: 26 });
    await request(app).patch(`/api/v1/delivery-partners/${partnerId}/availability`).set('Authorization', `Bearer ${token}`).send({ availability: 'ONLINE' });
    return { partnerId, token };
  }

  async function createAssignedDelivery() {
    const createRes = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ businessType: 'FOOD', vendorId, addressId, paymentMethod: 'COD', items: [{ productId, quantity: 1, addons: [] }] });
    const orderId = createRes.body.data._id;
    for (const status of ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP']) {
      await request(app).patch(`/api/v1/orders/${orderId}/status`).set('Authorization', `Bearer ${vendorToken}`).send({ status });
    }

    const partnerPhone = `98779${Math.floor(10000 + Math.random() * 89999)}`;
    const { partnerId, token: partnerToken } = await createOnlinePartner(partnerPhone);
    const assignRes = await request(app)
      .post('/api/v1/delivery/assign')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ orderId, deliveryPartnerId: partnerId });

    return { orderId, deliveryId: assignRes.body.data._id, partnerId, partnerToken };
  }

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();

    const location = await Location.create({ name: 'Issue City', code: 'ISSUECITY', state: 'UP', district: 'D1', latitude: 26, longitude: 26, serviceRadius: 20 });
    locationId = location.id;

    await DeliveryZone.create({
      locationId,
      name: 'Issue Zone',
      centerLatitude: 26,
      centerLongitude: 26,
      radius: 15,
      deliveryFee: 20,
      freeDeliveryAbove: 1000,
      estimatedDeliveryTime: 30,
      status: 'ACTIVE',
    });

    const password = await hashPassword('Password123');
    await AdminUser.create({ name: 'Super', email: 'di.super@example.com', password, role: 'SUPER_ADMIN', locationIds: [] });
    await AdminUser.create({ name: 'DeliveryOps', email: 'di.delivery@example.com', password, role: 'DELIVERY_ADMIN', locationIds: [] });
    await AdminUser.create({ name: 'Food', email: 'di.food@example.com', password, role: 'FOOD_ADMIN', locationIds: [] });
    superAdminToken = (await request(app).post('/api/v1/auth/admin/login').send({ email: 'di.super@example.com', password: 'Password123' })).body.data.accessToken;
    deliveryAdminToken = (await request(app).post('/api/v1/auth/admin/login').send({ email: 'di.delivery@example.com', password: 'Password123' })).body.data.accessToken;
    foodAdminToken = (await request(app).post('/api/v1/auth/admin/login').send({ email: 'di.food@example.com', password: 'Password123' })).body.data.accessToken;

    const vendor = await Vendor.create({
      locationId,
      restaurantName: 'Issue Restaurant',
      ownerName: 'Owner',
      phone: '9877800010',
      password: await hashPassword('VendorPass123'),
      address: 'Somewhere',
      latitude: 26,
      longitude: 26,
      status: 'ACTIVE',
      approvalStatus: 'APPROVED',
      isOpen: true,
    });
    vendorId = vendor.id;
    vendorToken = (await request(app).post('/api/v1/auth/vendor/login').send({ identifier: '9877800010', password: 'VendorPass123' })).body.data.accessToken;

    const category = await FoodCategory.create({ name: 'Issue Food Category', status: 'ACTIVE' });
    const product = await FoodProduct.create({ locationId, vendorId, categoryId: category.id, name: 'Issue Thali', price: 100, isAvailable: true, status: 'ACTIVE' });
    productId = product.id;

    const sendOtp = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9877800099' });
    const verify = await request(app).post('/api/v1/auth/customer/verify-otp').send({ phone: '9877800099', otp: sendOtp.body.data.devOtp });
    customerToken = verify.body.data.accessToken;
    const customerId = verify.body.data.customer._id;

    const addressRes = await request(app)
      .post(`/api/v1/customers/${customerId}/addresses`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ locationId, address: '1 Issue Lane', pincode: '110044', latitude: 26, longitude: 26 });
    addressId = addressRes.body.data._id;
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  it('rejects raising an issue against a delivery you have no connection to', async () => {
    const { deliveryId } = await createAssignedDelivery();

    const sendOtp = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9877800098' });
    const verify = await request(app).post('/api/v1/auth/customer/verify-otp').send({ phone: '9877800098', otp: sendOtp.body.data.devOtp });
    const otherCustomerToken = verify.body.data.accessToken;

    const res = await request(app)
      .post('/api/v1/delivery-issues')
      .set('Authorization', `Bearer ${otherCustomerToken}`)
      .send({ deliveryId, type: 'CUSTOMER_COMPLAINT', description: 'Not my order' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('DELIVERY_FORBIDDEN');
  });

  let issueDeliveryId: string;
  let issuePartnerToken: string;
  let issueId: string;

  it('lets the customer raise an issue on their own delivery', async () => {
    const delivered = await createAssignedDelivery();
    issueDeliveryId = delivered.deliveryId;
    issuePartnerToken = delivered.partnerToken;

    const res = await request(app)
      .post('/api/v1/delivery-issues')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ deliveryId: issueDeliveryId, type: 'CUSTOMER_UNAVAILABLE', description: 'Rider says nobody answered' });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('OPEN');
    expect(res.body.data.raisedByType).toBe('CUSTOMER');
    issueId = res.body.data._id;
  });

  it('lets the assigned delivery partner see the issue the customer raised on their delivery', async () => {
    const res = await request(app).get(`/api/v1/delivery-issues/${issueId}`).set('Authorization', `Bearer ${issuePartnerToken}`);
    expect(res.status).toBe(200);
  });

  it("rejects an unrelated delivery partner from viewing the issue", async () => {
    const { token: otherPartnerToken } = await createOnlinePartner('9877800097');
    const res = await request(app).get(`/api/v1/delivery-issues/${issueId}`).set('Authorization', `Bearer ${otherPartnerToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('DELIVERY_ISSUE_FORBIDDEN');
  });

  it("scopes the customer's list to issues on their own orders", async () => {
    const res = await request(app).get('/api/v1/delivery-issues').set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.some((i: { _id: string }) => i._id === issueId)).toBe(true);
  });

  it('lets the delivery partner raise their own issue too (e.g. a vehicle problem)', async () => {
    const res = await request(app)
      .post('/api/v1/delivery-issues')
      .set('Authorization', `Bearer ${issuePartnerToken}`)
      .send({ deliveryId: issueDeliveryId, type: 'VEHICLE_PROBLEM', description: 'Flat tire' });
    expect(res.status).toBe(201);
    expect(res.body.data.raisedByType).toBe('DELIVERY_PARTNER');
  });

  it('rejects a FOOD_ADMIN (no DELIVERY_ISSUE_MANAGE) from resolving an issue', async () => {
    const res = await request(app)
      .patch(`/api/v1/delivery-issues/${issueId}/status`)
      .set('Authorization', `Bearer ${foodAdminToken}`)
      .send({ status: 'RESOLVED', resolutionNote: 'Should not work' });
    expect(res.status).toBe(403);
  });

  it('requires a resolutionNote to resolve or close an issue', async () => {
    const res = await request(app)
      .patch(`/api/v1/delivery-issues/${issueId}/status`)
      .set('Authorization', `Bearer ${deliveryAdminToken}`)
      .send({ status: 'RESOLVED' });
    expect(res.status).toBe(422);
  });

  it('lets a DELIVERY_ADMIN move an issue through IN_PROGRESS to RESOLVED', async () => {
    const inProgress = await request(app)
      .patch(`/api/v1/delivery-issues/${issueId}/status`)
      .set('Authorization', `Bearer ${deliveryAdminToken}`)
      .send({ status: 'IN_PROGRESS' });
    expect(inProgress.status).toBe(200);
    expect(inProgress.body.data.status).toBe('IN_PROGRESS');

    const resolved = await request(app)
      .patch(`/api/v1/delivery-issues/${issueId}/status`)
      .set('Authorization', `Bearer ${deliveryAdminToken}`)
      .send({ status: 'RESOLVED', resolutionNote: 'Redelivered successfully' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.status).toBe('RESOLVED');
    expect(resolved.body.data.resolutionNote).toBe('Redelivered successfully');
    expect(resolved.body.data.resolvedAt).toBeTruthy();
  });
});
