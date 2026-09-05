import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { AdminUser } from '../../src/models/AdminUser';
import { Location } from '../../src/models/Location';
import { DeliveryZone } from '../../src/models/DeliveryZone';
import { Vendor } from '../../src/models/Vendor';
import { FoodCategory } from '../../src/models/FoodCategory';
import { FoodProduct } from '../../src/models/FoodProduct';
import { Notification } from '../../src/models/Notification';
import { NotificationDevice } from '../../src/models/NotificationDevice';
import { hashPassword } from '../../src/utils/password';
import { startTestDatabase, stopTestDatabase } from './testServer';

describe('Notifications: device registration, in-app inbox, and event-triggered sends', () => {
  let locationId: string;
  let customerToken: string;
  let customerId: string;
  let addressId: string;
  let vendorId: string;
  let productId: string;
  let financeAdminToken: string;

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();

    const location = await Location.create({ name: 'Notify City', code: 'NOTIFYCITY', state: 'UP', district: 'D1', latitude: 24, longitude: 24, serviceRadius: 20 });
    locationId = location.id;

    await DeliveryZone.create({
      locationId,
      name: 'Notify Zone',
      centerLatitude: 24,
      centerLongitude: 24,
      radius: 10,
      deliveryFee: 15,
      freeDeliveryAbove: 1000,
      estimatedDeliveryTime: 30,
      status: 'ACTIVE',
    });

    const vendor = await Vendor.create({
      locationId,
      restaurantName: 'Notify Restaurant',
      ownerName: 'Owner',
      phone: '9877900301',
      password: await hashPassword('VendorPass123'),
      address: 'Somewhere',
      latitude: 24,
      longitude: 24,
      status: 'ACTIVE',
      approvalStatus: 'APPROVED',
      isOpen: true,
    });
    vendorId = vendor.id;

    const category = await FoodCategory.create({ name: 'Notify Food Category', status: 'ACTIVE' });
    const product = await FoodProduct.create({ locationId, vendorId, categoryId: category.id, name: 'Notify Thali', price: 100, isAvailable: true, status: 'ACTIVE' });
    productId = product.id;

    const sendOtp = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9877900350' });
    const verify = await request(app).post('/api/v1/auth/customer/verify-otp').send({ phone: '9877900350', otp: sendOtp.body.data.devOtp });
    customerToken = verify.body.data.accessToken;
    customerId = verify.body.data.customer._id;

    const addressRes = await request(app)
      .post(`/api/v1/customers/${customerId}/addresses`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ locationId, address: '1 Notify Lane', pincode: '110022', latitude: 24, longitude: 24 });
    addressId = addressRes.body.data._id;

    const adminPassword = await hashPassword('Password123');
    await AdminUser.create({ name: 'Finance', email: 'notify.finance@example.com', password: adminPassword, role: 'FINANCE_ADMIN', locationIds: [] });
    financeAdminToken = (
      await request(app).post('/api/v1/auth/admin/login').send({ email: 'notify.finance@example.com', password: 'Password123' })
    ).body.data.accessToken;
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  let deviceId: string;

  it('registers a device', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/register-device')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ playerId: 'onesignal-player-1', deviceType: 'ANDROID', deviceId: 'phone-1' });
    expect(res.status).toBe(201);
    expect(res.body.data.playerId).toBe('onesignal-player-1');
    deviceId = res.body.data._id;
  });

  it('re-registering the same deviceId upserts in place rather than duplicating', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/register-device')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ playerId: 'onesignal-player-1-refreshed', deviceType: 'ANDROID', deviceId: 'phone-1' });
    expect(res.status).toBe(201);
    expect(res.body.data.playerId).toBe('onesignal-player-1-refreshed');

    const count = await NotificationDevice.countDocuments({ userId: customerId, deviceId: 'phone-1' });
    expect(count).toBe(1);
  });

  it("rejects a different customer from unregistering someone else's device", async () => {
    const otherSendOtp = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9877900399' });
    const otherVerify = await request(app).post('/api/v1/auth/customer/verify-otp').send({ phone: '9877900399', otp: otherSendOtp.body.data.devOtp });
    const otherToken = otherVerify.body.data.accessToken;

    const res = await request(app).delete(`/api/v1/notifications/device/${deviceId}`).set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('DEVICE_FORBIDDEN');
  });

  it('placing an order creates an ORDER_CREATED in-app notification, and paying with WALLET also creates a PAYMENT_SUCCESS one', async () => {
    await request(app)
      .post(`/api/v1/customers/${customerId}/wallet/adjust`)
      .set('Authorization', `Bearer ${financeAdminToken}`)
      .send({ amount: 500, type: 'CREDIT', note: 'Notification test top-up' });

    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ businessType: 'FOOD', vendorId, addressId, paymentMethod: 'WALLET', items: [{ productId, quantity: 1, addons: [] }] });
    expect(res.status).toBe(201);
    const orderId = res.body.data._id;

    const created = await Notification.findOne({ userId: customerId, type: 'ORDER_CREATED', 'data.orderId': orderId });
    expect(created).not.toBeNull();
    const paid = await Notification.findOne({ userId: customerId, type: 'PAYMENT_SUCCESS', 'data.orderId': orderId });
    expect(paid).not.toBeNull();
  });

  it('cancelling a paid order creates ORDER_CANCELLED and REFUND_COMPLETED notifications', async () => {
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ businessType: 'FOOD', vendorId, addressId, paymentMethod: 'WALLET', items: [{ productId, quantity: 1, addons: [] }] });
    const orderId = res.body.data._id;

    const cancelRes = await request(app)
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ reason: 'Changed my mind' });
    expect(cancelRes.status).toBe(200);

    const cancelled = await Notification.findOne({ userId: customerId, type: 'ORDER_CANCELLED', 'data.orderId': orderId });
    expect(cancelled).not.toBeNull();
    const refunded = await Notification.findOne({ userId: customerId, type: 'REFUND_COMPLETED', 'data.orderId': orderId });
    expect(refunded).not.toBeNull();
  });

  it('lists the inbox newest-first, reports an accurate unread count, and supports marking read', async () => {
    const listRes = await request(app).get('/api/v1/notifications').set('Authorization', `Bearer ${customerToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBeGreaterThan(0);
    expect(listRes.body.data.every((n: { isRead: boolean }) => n.isRead === false)).toBe(true);

    const unreadRes = await request(app).get('/api/v1/notifications/unread-count').set('Authorization', `Bearer ${customerToken}`);
    const unreadBefore = unreadRes.body.data.count;
    expect(unreadBefore).toBeGreaterThan(0);

    const oneId = listRes.body.data[0]._id;
    const markRes = await request(app).patch(`/api/v1/notifications/${oneId}/read`).set('Authorization', `Bearer ${customerToken}`);
    expect(markRes.status).toBe(200);
    expect(markRes.body.data.isRead).toBe(true);

    const unreadAfter = await request(app).get('/api/v1/notifications/unread-count').set('Authorization', `Bearer ${customerToken}`);
    expect(unreadAfter.body.data.count).toBe(unreadBefore - 1);
  });

  it('marks every remaining notification read via read-all', async () => {
    const res = await request(app).patch('/api/v1/notifications/read-all').set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(200);

    const unreadRes = await request(app).get('/api/v1/notifications/unread-count').set('Authorization', `Bearer ${customerToken}`);
    expect(unreadRes.body.data.count).toBe(0);
  });

  it("rejects a customer reading another customer's notification", async () => {
    const own = await request(app).get('/api/v1/notifications').set('Authorization', `Bearer ${customerToken}`);
    const someId = own.body.data[0]._id;

    const otherSendOtp = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9877900398' });
    const otherVerify = await request(app).post('/api/v1/auth/customer/verify-otp').send({ phone: '9877900398', otp: otherSendOtp.body.data.devOtp });
    const otherToken = otherVerify.body.data.accessToken;

    const res = await request(app).patch(`/api/v1/notifications/${someId}/read`).set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOTIFICATION_FORBIDDEN');
  });

  it('deletes an own notification', async () => {
    const listRes = await request(app).get('/api/v1/notifications').set('Authorization', `Bearer ${customerToken}`);
    const totalBefore = listRes.body.pagination.total;
    const oneId = listRes.body.data[0]._id;

    const delRes = await request(app).delete(`/api/v1/notifications/${oneId}`).set('Authorization', `Bearer ${customerToken}`);
    expect(delRes.status).toBe(200);

    const after = await request(app).get('/api/v1/notifications').set('Authorization', `Bearer ${customerToken}`);
    expect(after.body.pagination.total).toBe(totalBefore - 1);
  });

  it('unregisters an own device', async () => {
    const res = await request(app).delete(`/api/v1/notifications/device/${deviceId}`).set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(200);
    const count = await NotificationDevice.countDocuments({ _id: deviceId });
    expect(count).toBe(0);
  });
});
