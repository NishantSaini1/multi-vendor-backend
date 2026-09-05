import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { AdminUser } from '../../src/models/AdminUser';
import { Location } from '../../src/models/Location';
import { DeliveryZone } from '../../src/models/DeliveryZone';
import { Vendor } from '../../src/models/Vendor';
import { FoodCategory } from '../../src/models/FoodCategory';
import { FoodProduct } from '../../src/models/FoodProduct';
import { DeliveryPartner } from '../../src/models/DeliveryPartner';
import { hashPassword } from '../../src/utils/password';
import { startTestDatabase, stopTestDatabase } from './testServer';

describe('Delivery assignment engine + status machine', () => {
  let locationId: string;
  let superAdminToken: string;
  let customerToken: string;
  let addressId: string;
  let vendorId: string;
  let vendorToken: string;
  let productId: string;

  async function createReadyOrder() {
    const createRes = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ businessType: 'FOOD', vendorId, addressId, paymentMethod: 'COD', items: [{ productId, quantity: 1, addons: [] }] });
    const orderId = createRes.body.data._id;
    for (const status of ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP']) {
      await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ status });
    }
    return orderId;
  }

  async function createOnlinePartner(phone: string, lat: number, lng: number) {
    const created = await request(app)
      .post('/api/v1/delivery-partners')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ locationId, name: `Partner ${phone}`, phone, password: 'RiderPass123' });
    const partnerId = created.body.data._id;
    await request(app).post(`/api/v1/delivery-partners/${partnerId}/approve`).set('Authorization', `Bearer ${superAdminToken}`);
    const login = await request(app).post('/api/v1/auth/delivery/login').send({ phone, password: 'RiderPass123' });
    const token = login.body.data.accessToken;
    await request(app).post(`/api/v1/delivery-partners/${partnerId}/location`).set('Authorization', `Bearer ${token}`).send({ latitude: lat, longitude: lng });
    await request(app).patch(`/api/v1/delivery-partners/${partnerId}/availability`).set('Authorization', `Bearer ${token}`).send({ availability: 'ONLINE' });
    return { partnerId, token };
  }

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();

    const location = await Location.create({ name: 'Delivery Flow City', code: 'DFCITY', state: 'UP', district: 'D1', latitude: 25, longitude: 25, serviceRadius: 20 });
    locationId = location.id;

    await DeliveryZone.create({
      locationId,
      name: 'DF Zone',
      centerLatitude: 25,
      centerLongitude: 25,
      radius: 15,
      deliveryFee: 20,
      freeDeliveryAbove: 1000,
      estimatedDeliveryTime: 30,
      status: 'ACTIVE',
    });

    const adminPassword = await hashPassword('Password123');
    await AdminUser.create({ name: 'Super', email: 'df.super@example.com', password: adminPassword, role: 'SUPER_ADMIN', locationIds: [] });
    superAdminToken = (await request(app).post('/api/v1/auth/admin/login').send({ email: 'df.super@example.com', password: 'Password123' })).body.data.accessToken;

    const vendorPassword = await hashPassword('VendorPass123');
    const vendor = await Vendor.create({
      locationId,
      restaurantName: 'DF Restaurant',
      ownerName: 'Owner',
      phone: '9888800001',
      password: vendorPassword,
      address: 'Restaurant Address',
      latitude: 25,
      longitude: 25,
      status: 'ACTIVE',
      approvalStatus: 'APPROVED',
      isOpen: true,
    });
    vendorId = vendor.id;
    vendorToken = (await request(app).post('/api/v1/auth/vendor/login').send({ identifier: '9888800001', password: 'VendorPass123' })).body.data.accessToken;

    const category = await FoodCategory.create({ name: 'DF Category', status: 'ACTIVE' });
    const product = await FoodProduct.create({ locationId, vendorId, categoryId: category.id, name: 'DF Item', price: 100, isAvailable: true, status: 'ACTIVE' });
    productId = product.id;

    const sendOtp = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9888800099' });
    const verify = await request(app).post('/api/v1/auth/customer/verify-otp').send({ phone: '9888800099', otp: sendOtp.body.data.devOtp });
    customerToken = verify.body.data.accessToken;
    const customerId = verify.body.data.customer._id;
    const addressRes = await request(app)
      .post(`/api/v1/customers/${customerId}/addresses`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ locationId, address: 'Customer address', pincode: '110088', latitude: 25.01, longitude: 25.01 });
    addressId = addressRes.body.data._id;
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  it('rejects assignment to an order that is not READY_FOR_PICKUP', async () => {
    const createRes = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ businessType: 'FOOD', vendorId, addressId, paymentMethod: 'COD', items: [{ productId, quantity: 1, addons: [] }] });
    const { partnerId } = await createOnlinePartner('9888810001', 25, 25);

    const res = await request(app)
      .post('/api/v1/delivery/assign')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ orderId: createRes.body.data._id, deliveryPartnerId: partnerId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ORDER_NOT_READY_FOR_ASSIGNMENT');
  });

  it('rejects assignment to an OFFLINE partner', async () => {
    const orderId = await createReadyOrder();
    const offlinePartner = await DeliveryPartner.create({
      locationId,
      name: 'Offline Rider',
      phone: '9888810002',
      password: await hashPassword('RiderPass123'),
      status: 'ACTIVE',
      availability: 'OFFLINE',
    });

    const res = await request(app)
      .post('/api/v1/delivery/assign')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ orderId, deliveryPartnerId: offlinePartner.id });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DELIVERY_PARTNER_NOT_AVAILABLE');
  });

  let assignedOrderId: string;
  let assignedPartnerId: string;
  let assignedPartnerToken: string;
  let deliveryId: string;

  it('assigns an available partner, updating the order, delivery, and partner state together', async () => {
    assignedOrderId = await createReadyOrder();
    const { partnerId, token } = await createOnlinePartner('9888810003', 25, 25);
    assignedPartnerId = partnerId;
    assignedPartnerToken = token;

    const res = await request(app)
      .post('/api/v1/delivery/assign')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ orderId: assignedOrderId, deliveryPartnerId: partnerId });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('ASSIGNED');
    deliveryId = res.body.data._id;

    const orderRes = await request(app).get(`/api/v1/orders/${assignedOrderId}`).set('Authorization', `Bearer ${superAdminToken}`);
    expect(orderRes.body.data.status).toBe('PARTNER_ASSIGNED');
    expect(orderRes.body.data.deliveryPartnerId).toBe(partnerId);

    const partnerRes = await request(app).get(`/api/v1/delivery-partners/${partnerId}`).set('Authorization', `Bearer ${superAdminToken}`);
    expect(partnerRes.body.data.availability).toBe('BUSY');
  });

  it('removes the now-BUSY partner from the available-partners search', async () => {
    const res = await request(app)
      .get('/api/v1/delivery/available-partners')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .query({ locationId, latitude: '25', longitude: '25', radiusKm: '10' });
    expect(res.body.data.some((p: { id: string }) => p.id === assignedPartnerId)).toBe(false);
  });

  it('rejects assigning a second partner once one is already assigned (the order has already moved past READY_FOR_PICKUP)', async () => {
    const { partnerId } = await createOnlinePartner('9888810004', 25, 25);
    const res = await request(app)
      .post('/api/v1/delivery/assign')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ orderId: assignedOrderId, deliveryPartnerId: partnerId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ORDER_NOT_READY_FOR_ASSIGNMENT');
  });

  it("forbids a different delivery partner from updating this delivery's status", async () => {
    const { token: otherToken } = await createOnlinePartner('9888810005', 25, 25);
    const res = await request(app)
      .patch(`/api/v1/deliveries/${deliveryId}/status`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ status: 'ACCEPTED' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('DELIVERY_FORBIDDEN');
  });

  it('rejects an invalid delivery status jump', async () => {
    const res = await request(app)
      .patch(`/api/v1/deliveries/${deliveryId}/status`)
      .set('Authorization', `Bearer ${assignedPartnerToken}`)
      .send({ status: 'DELIVERED' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_DELIVERY_STATUS_TRANSITION');
  });

  it('walks the delivery through ACCEPTED -> ARRIVED_AT_PICKUP -> PICKED_UP, syncing the order status', async () => {
    for (const status of ['ACCEPTED', 'ARRIVED_AT_PICKUP', 'PICKED_UP']) {
      const res = await request(app)
        .patch(`/api/v1/deliveries/${deliveryId}/status`)
        .set('Authorization', `Bearer ${assignedPartnerToken}`)
        .send({ status });
      expect(res.status).toBe(200);
    }

    const orderRes = await request(app).get(`/api/v1/orders/${assignedOrderId}`).set('Authorization', `Bearer ${superAdminToken}`);
    expect(orderRes.body.data.status).toBe('PICKED_UP');
  });

  it("lets the customer track their own delivery, but not another customer's", async () => {
    const trackingRes = await request(app)
      .get(`/api/v1/deliveries/${deliveryId}/tracking`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(trackingRes.status).toBe(200);
    expect(trackingRes.body.data.status).toBe('PICKED_UP');
    expect(trackingRes.body.data.partnerLocation).not.toBeNull();

    const otherSendOtp = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9888899999' });
    const otherVerify = await request(app).post('/api/v1/auth/customer/verify-otp').send({ phone: '9888899999', otp: otherSendOtp.body.data.devOtp });
    const res = await request(app)
      .get(`/api/v1/deliveries/${deliveryId}/tracking`)
      .set('Authorization', `Bearer ${otherVerify.body.data.accessToken}`);
    expect(res.status).toBe(403);
  });

  it('completes the delivery: order DELIVERED, partner freed and back ONLINE with an incremented completedOrders count', async () => {
    await request(app)
      .patch(`/api/v1/deliveries/${deliveryId}/status`)
      .set('Authorization', `Bearer ${assignedPartnerToken}`)
      .send({ status: 'OUT_FOR_DELIVERY' });
    const res = await request(app)
      .patch(`/api/v1/deliveries/${deliveryId}/status`)
      .set('Authorization', `Bearer ${assignedPartnerToken}`)
      .send({ status: 'DELIVERED' });
    expect(res.status).toBe(200);

    const orderRes = await request(app).get(`/api/v1/orders/${assignedOrderId}`).set('Authorization', `Bearer ${superAdminToken}`);
    expect(orderRes.body.data.status).toBe('DELIVERED');

    const partnerRes = await request(app).get(`/api/v1/delivery-partners/${assignedPartnerId}`).set('Authorization', `Bearer ${superAdminToken}`);
    expect(partnerRes.body.data.availability).toBe('ONLINE');
    expect(partnerRes.body.data.completedOrders).toBe(1);
  });

  describe('reassignment and delivery failure', () => {
    let orderId: string;
    let originalPartnerId: string;
    let originalPartnerToken: string;

    beforeAll(async () => {
      orderId = await createReadyOrder();
      const created = await createOnlinePartner('9888820001', 25, 25);
      originalPartnerId = created.partnerId;
      originalPartnerToken = created.token;
      await request(app)
        .post('/api/v1/delivery/assign')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ orderId, deliveryPartnerId: originalPartnerId });
    });

    it('reassigns to a new partner, freeing the original one back to ONLINE', async () => {
      const { partnerId: newPartnerId } = await createOnlinePartner('9888820002', 25, 25);

      const res = await request(app)
        .post('/api/v1/delivery/reassign')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ orderId, deliveryPartnerId: newPartnerId, reason: 'Original partner unreachable' });
      expect(res.status).toBe(200);

      const orderRes = await request(app).get(`/api/v1/orders/${orderId}`).set('Authorization', `Bearer ${superAdminToken}`);
      expect(orderRes.body.data.deliveryPartnerId).toBe(newPartnerId);

      const oldPartnerRes = await request(app).get(`/api/v1/delivery-partners/${originalPartnerId}`).set('Authorization', `Bearer ${superAdminToken}`);
      expect(oldPartnerRes.body.data.availability).toBe('ONLINE');

      // The original partner's token should no longer be able to act on this delivery.
      const deliveryRes = await request(app).get(`/api/v1/orders/${orderId}`).set('Authorization', `Bearer ${superAdminToken}`);
      const forbiddenRes = await request(app)
        .patch(`/api/v1/deliveries/${deliveryRes.body.data.deliveryId}/status`)
        .set('Authorization', `Bearer ${originalPartnerToken}`)
        .send({ status: 'ACCEPTED' });
      expect(forbiddenRes.status).toBe(403);
    });

    it('reverts the order to READY_FOR_PICKUP and frees the partner when a delivery FAILs', async () => {
      const failOrderId = await createReadyOrder();
      const { partnerId, token } = await createOnlinePartner('9888820003', 25, 25);
      const assignRes = await request(app)
        .post('/api/v1/delivery/assign')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ orderId: failOrderId, deliveryPartnerId: partnerId });
      const failDeliveryId = assignRes.body.data._id;

      await request(app).patch(`/api/v1/deliveries/${failDeliveryId}/status`).set('Authorization', `Bearer ${token}`).send({ status: 'ACCEPTED' });
      await request(app).patch(`/api/v1/deliveries/${failDeliveryId}/status`).set('Authorization', `Bearer ${token}`).send({ status: 'ARRIVED_AT_PICKUP' });
      const failRes = await request(app).patch(`/api/v1/deliveries/${failDeliveryId}/status`).set('Authorization', `Bearer ${token}`).send({ status: 'FAILED' });
      expect(failRes.status).toBe(200);

      const orderRes = await request(app).get(`/api/v1/orders/${failOrderId}`).set('Authorization', `Bearer ${superAdminToken}`);
      expect(orderRes.body.data.status).toBe('READY_FOR_PICKUP');
      expect(orderRes.body.data.deliveryPartnerId).toBeUndefined();

      const partnerRes = await request(app).get(`/api/v1/delivery-partners/${partnerId}`).set('Authorization', `Bearer ${superAdminToken}`);
      expect(partnerRes.body.data.availability).toBe('ONLINE');
    });
  });
});
