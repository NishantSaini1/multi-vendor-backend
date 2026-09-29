import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { env } from '../../src/config/env';
import { AdminUser } from '../../src/models/AdminUser';
import { Location } from '../../src/models/Location';
import { DeliveryZone } from '../../src/models/DeliveryZone';
import { FoodCategory } from '../../src/models/FoodCategory';
import { DeliveryPartner } from '../../src/models/DeliveryPartner';
import { Delivery } from '../../src/models/Delivery';
import { Order } from '../../src/models/Order';
import { runDeliveryAutoAssignSweep } from '../../src/services/delivery.service';
import { hashPassword } from '../../src/utils/password';
import { signAccessToken } from '../../src/utils/jwt';
import { startTestDatabase, stopTestDatabase } from './testServer';
import { createTestVendor, createOrderableFoodItem } from './helpers/foodFixtures';

// Nearest-partner auto-assignment (delivery.service.ts's
// autoAssignDeliveryPartner): an order that becomes READY_FOR_PICKUP goes to
// the closest ACTIVE + ONLINE partner; if they decline (or never answer) it
// moves to the next closest; an admin can still assign/reassign by hand.
describe('Delivery auto-assignment', () => {
  let locationId: string;
  let superAdminToken: string;
  let customerToken: string;
  let addressId: string;
  let vendorId: string;
  let vendorToken: string;
  let productId: string;
  let phoneSeq = 0;

  // Vendor (the pickup point) sits at (25, 25); 0.01° ≈ 1.1 km.
  async function createReadyOrder() {
    const createRes = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ businessType: 'FOOD', vendorId, addressId, paymentMethod: 'COD', items: [{ productId, quantity: 1, modifiers: [] }] });
    const orderId = createRes.body.data._id;
    let last;
    for (const status of ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP']) {
      last = await request(app).patch(`/api/v1/orders/${orderId}/status`).set('Authorization', `Bearer ${vendorToken}`).send({ status });
    }
    return { orderId, readyResponse: last! };
  }

  async function createPartner(lat: number, lng: number, availability: 'ONLINE' | 'OFFLINE' = 'ONLINE') {
    phoneSeq += 1;
    const phone = `97777${String(phoneSeq).padStart(5, '0')}`;
    const created = await request(app)
      .post('/api/v1/delivery-partners')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ locationId, name: `Rider ${phone}`, phone, password: 'RiderPass123' });
    const partnerId = created.body.data._id;
    await request(app).post(`/api/v1/delivery-partners/${partnerId}/approve`).set('Authorization', `Bearer ${superAdminToken}`);
    // Signed directly (same payload as deliveryAuth.service) rather than via
    // /auth/delivery/login, whose per-IP rate limit this suite would exceed.
    const token = signAccessToken({ userId: partnerId, userType: 'DELIVERY_PARTNER', role: 'DELIVERY_PARTNER', locationIds: [locationId] });
    await request(app).post(`/api/v1/delivery-partners/${partnerId}/location`).set('Authorization', `Bearer ${token}`).send({ latitude: lat, longitude: lng });
    if (availability === 'ONLINE') {
      await request(app).patch(`/api/v1/delivery-partners/${partnerId}/availability`).set('Authorization', `Bearer ${token}`).send({ availability: 'ONLINE' });
    }
    return { partnerId, token };
  }

  // Takes every partner created by earlier tests off the board so each test
  // controls exactly who is available.
  async function everyoneOffline() {
    await DeliveryPartner.updateMany({}, { $set: { availability: 'OFFLINE' } });
  }

  function decline(deliveryId: string, token: string) {
    return request(app).patch(`/api/v1/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${token}`).send({ status: 'CANCELLED' });
  }

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();
    env.AUTO_ASSIGN_DELIVERY = true;

    const location = await Location.create({ name: 'Auto Assign City', code: 'AACITY', state: 'UP', district: 'D1', latitude: 25, longitude: 25, serviceRadius: 20 });
    locationId = location.id;
    await DeliveryZone.create({
      locationId,
      name: 'AA Zone',
      centerLatitude: 25,
      centerLongitude: 25,
      radius: 15,
      deliveryFee: 20,
      freeDeliveryAbove: 1000,
      estimatedDeliveryTime: 30,
      status: 'ACTIVE',
    });

    await AdminUser.create({ name: 'Super', email: 'aa.super@example.com', password: await hashPassword('Password123'), role: 'SUPER_ADMIN', locationIds: [] });
    superAdminToken = (await request(app).post('/api/v1/auth/admin/login').send({ email: 'aa.super@example.com', password: 'Password123' })).body.data.accessToken;

    const vendor = await createTestVendor({
      locationId,
      restaurantName: 'AA Restaurant',
      ownerName: 'Owner',
      phone: '9777700001',
      password: await hashPassword('VendorPass123'),
      address: 'Restaurant Address',
      latitude: 25,
      longitude: 25,
      status: 'ACTIVE',
      approvalStatus: 'APPROVED',
      isOpen: true,
    });
    vendorId = vendor.id;
    vendorToken = (await request(app).post('/api/v1/auth/vendor/login').send({ identifier: '9777700001', password: 'VendorPass123' })).body.data.accessToken;

    const category = await FoodCategory.create({ name: 'AA Category', status: 'ACTIVE' });
    productId = (await createOrderableFoodItem(vendorId, category.id, { name: 'AA Item', price: 100 })).id;

    const sendOtp = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9777700099' });
    const verify = await request(app).post('/api/v1/auth/customer/verify-otp').send({ phone: '9777700099', otp: sendOtp.body.data.devOtp });
    customerToken = verify.body.data.accessToken;
    const addressRes = await request(app)
      .post(`/api/v1/customers/${verify.body.data.customer._id}/addresses`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ locationId, address: 'Customer address', pincode: '110088', latitude: 25.01, longitude: 25.01 });
    addressId = addressRes.body.data._id;
  });

  afterAll(async () => {
    env.AUTO_ASSIGN_DELIVERY = false;
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  it('assigns a READY_FOR_PICKUP order to the nearest online partner, skipping offline and out-of-radius ones', async () => {
    await everyoneOffline();
    const far = await createPartner(25.02, 25.02); // ~3 km
    const near = await createPartner(25.005, 25.005); // ~0.7 km
    await createPartner(25.001, 25.001, 'OFFLINE'); // closest, but offline
    await createPartner(25.2, 25.2); // ~30 km, outside AUTO_ASSIGN_RADIUS_KM

    const { orderId, readyResponse } = await createReadyOrder();
    expect(readyResponse.status).toBe(200);
    expect(readyResponse.body.data.status).toBe('PARTNER_ASSIGNED');
    expect(readyResponse.body.data.deliveryPartnerId).toBe(near.partnerId);

    const delivery = await Delivery.findOne({ orderId });
    expect(delivery!.deliveryPartnerId.toString()).toBe(near.partnerId);
    expect(delivery!.assignmentMode).toBe('AUTO');
    expect(delivery!.status).toBe('ASSIGNED');
    expect((await DeliveryPartner.findById(near.partnerId))!.availability).toBe('BUSY');
    expect((await DeliveryPartner.findById(far.partnerId))!.availability).toBe('ONLINE');
  });

  it('moves the order to the next nearest partner when the assigned one declines, then leaves it for the admin when nobody is left', async () => {
    await everyoneOffline();
    const first = await createPartner(25.003, 25.003);
    const second = await createPartner(25.01, 25.01);

    const { orderId } = await createReadyOrder();
    const delivery = await Delivery.findOne({ orderId });
    expect(delivery!.deliveryPartnerId.toString()).toBe(first.partnerId);

    expect((await decline(delivery!.id, first.token)).status).toBe(200);

    // Same Delivery record (one per order), now with the second partner.
    const afterFirstDecline = await Delivery.findOne({ orderId });
    expect(afterFirstDecline!.id).toBe(delivery!.id);
    expect(afterFirstDecline!.deliveryPartnerId.toString()).toBe(second.partnerId);
    expect(afterFirstDecline!.status).toBe('ASSIGNED');
    expect(afterFirstDecline!.declinedPartnerIds.map(String)).toEqual([first.partnerId]);
    expect((await DeliveryPartner.findById(first.partnerId))!.availability).toBe('ONLINE');
    expect((await Order.findById(orderId))!.deliveryPartnerId!.toString()).toBe(second.partnerId);

    // The first partner is online again but already declined — not re-offered.
    expect((await decline(delivery!.id, second.token)).status).toBe(200);
    const order = await Order.findById(orderId);
    expect(order!.status).toBe('READY_FOR_PICKUP');
    expect(order!.deliveryPartnerId).toBeUndefined();
    expect((await Delivery.findOne({ orderId }))!.declinedPartnerIds.map(String).sort()).toEqual([first.partnerId, second.partnerId].sort());

    // An admin can still hand it to a partner who declined earlier.
    const manual = await request(app)
      .post('/api/v1/delivery/assign')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ orderId, deliveryPartnerId: first.partnerId });
    expect(manual.status).toBe(201);
    expect(manual.body.data._id).toBe(delivery!.id);
    expect(manual.body.data.assignmentMode).toBe('MANUAL');
    expect((await Order.findById(orderId))!.status).toBe('PARTNER_ASSIGNED');
  });

  it('lets an admin reassign an auto-assigned order to a partner of their choice', async () => {
    await everyoneOffline();
    const auto = await createPartner(25.002, 25.002);
    const chosen = await createPartner(25.03, 25.03);

    const { orderId } = await createReadyOrder();
    expect((await Delivery.findOne({ orderId }))!.deliveryPartnerId.toString()).toBe(auto.partnerId);

    const res = await request(app)
      .post('/api/v1/delivery/reassign')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ orderId, deliveryPartnerId: chosen.partnerId, reason: 'Customer asked for this rider' });
    expect(res.status).toBe(200);
    const delivery = await Delivery.findOne({ orderId });
    expect(delivery!.deliveryPartnerId.toString()).toBe(chosen.partnerId);
    expect(delivery!.assignmentMode).toBe('MANUAL');
    expect((await DeliveryPartner.findById(auto.partnerId))!.availability).toBe('ONLINE');
  });

  it('moves on from an auto-assigned partner who does not respond within the acceptance window', async () => {
    await everyoneOffline();
    const silent = await createPartner(25.002, 25.002);
    const next = await createPartner(25.01, 25.01);

    const { orderId } = await createReadyOrder();
    const delivery = await Delivery.findOne({ orderId });
    expect(delivery!.deliveryPartnerId.toString()).toBe(silent.partnerId);

    // Not yet timed out — the sweep leaves it alone.
    await runDeliveryAutoAssignSweep();
    expect((await Delivery.findOne({ orderId }))!.deliveryPartnerId.toString()).toBe(silent.partnerId);

    await Delivery.updateOne({ _id: delivery!._id }, { $set: { assignedAt: new Date(Date.now() - (env.AUTO_ASSIGN_ACCEPT_TIMEOUT_SECONDS + 5) * 1000) } });
    const result = await runDeliveryAutoAssignSweep();
    expect(result.timedOut).toBe(1);

    const reassigned = await Delivery.findOne({ orderId });
    expect(reassigned!.deliveryPartnerId.toString()).toBe(next.partnerId);
    expect(reassigned!.declinedPartnerIds.map(String)).toEqual([silent.partnerId]);
    expect((await DeliveryPartner.findById(silent.partnerId))!.availability).toBe('ONLINE');
  });

  it('assigns a waiting order on the next sweep once a partner comes online', async () => {
    await everyoneOffline();
    const { orderId, readyResponse } = await createReadyOrder();
    expect(readyResponse.body.data.status).toBe('READY_FOR_PICKUP');

    const late = await createPartner(25.004, 25.004);
    await runDeliveryAutoAssignSweep();

    const order = await Order.findById(orderId);
    expect(order!.status).toBe('PARTNER_ASSIGNED');
    expect(order!.deliveryPartnerId!.toString()).toBe(late.partnerId);
  });
});
