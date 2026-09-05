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

describe('Settlements: generation from DELIVERED orders, commission resolution, process/pay lifecycle', () => {
  let locationId: string;
  let superAdminToken: string;
  let financeAdminToken: string;
  let foodAdminToken: string; // has no SETTLEMENT_PROCESS permission
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
      await request(app).patch(`/api/v1/orders/${orderId}/status`).set('Authorization', `Bearer ${vendorToken}`).send({ status });
    }
    return orderId;
  }

  async function createOnlinePartner(phone: string) {
    const created = await request(app)
      .post('/api/v1/delivery-partners')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ locationId, name: `Partner ${phone}`, phone, password: 'RiderPass123' });
    const partnerId = created.body.data._id;
    await request(app).post(`/api/v1/delivery-partners/${partnerId}/approve`).set('Authorization', `Bearer ${superAdminToken}`);
    const login = await request(app).post('/api/v1/auth/delivery/login').send({ phone, password: 'RiderPass123' });
    const token = login.body.data.accessToken;
    await request(app).post(`/api/v1/delivery-partners/${partnerId}/location`).set('Authorization', `Bearer ${token}`).send({ latitude: 18, longitude: 18 });
    await request(app).patch(`/api/v1/delivery-partners/${partnerId}/availability`).set('Authorization', `Bearer ${token}`).send({ availability: 'ONLINE' });
    return { partnerId, token };
  }

  // Full pipeline: place a FOOD order for `vendorId`, walk it to READY_FOR_PICKUP,
  // assign an online partner, and walk the delivery to DELIVERED. Returns the
  // order id and the delivery partner id who completed it.
  async function deliverOrder() {
    const orderId = await createReadyOrder();
    const partnerPhone = `98776${Math.floor(10000 + Math.random() * 89999)}`;
    const { partnerId, token: partnerToken } = await createOnlinePartner(partnerPhone);

    const assignRes = await request(app)
      .post('/api/v1/delivery/assign')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ orderId, deliveryPartnerId: partnerId });
    const deliveryId = assignRes.body.data._id;

    for (const status of ['ACCEPTED', 'ARRIVED_AT_PICKUP', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
      await request(app).patch(`/api/v1/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${partnerToken}`).send({ status });
    }

    return { orderId, partnerId };
  }

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();

    const location = await Location.create({ name: 'Settlement City', code: 'SETTLECITY', state: 'UP', district: 'D1', latitude: 18, longitude: 18, serviceRadius: 20 });
    locationId = location.id;

    await DeliveryZone.create({
      locationId,
      name: 'Settlement Zone',
      centerLatitude: 18,
      centerLongitude: 18,
      radius: 15,
      deliveryFee: 30,
      freeDeliveryAbove: 1000,
      estimatedDeliveryTime: 30,
      status: 'ACTIVE',
    });

    const password = await hashPassword('Password123');
    await AdminUser.create({ name: 'Super', email: 's.super@example.com', password, role: 'SUPER_ADMIN', locationIds: [] });
    await AdminUser.create({ name: 'Finance', email: 's.finance@example.com', password, role: 'FINANCE_ADMIN', locationIds: [] });
    await AdminUser.create({ name: 'Food', email: 's.food@example.com', password, role: 'FOOD_ADMIN', locationIds: [] });
    superAdminToken = (await request(app).post('/api/v1/auth/admin/login').send({ email: 's.super@example.com', password: 'Password123' })).body.data.accessToken;
    financeAdminToken = (await request(app).post('/api/v1/auth/admin/login').send({ email: 's.finance@example.com', password: 'Password123' })).body.data.accessToken;
    foodAdminToken = (await request(app).post('/api/v1/auth/admin/login').send({ email: 's.food@example.com', password: 'Password123' })).body.data.accessToken;

    const vendor = await Vendor.create({
      locationId,
      restaurantName: 'Settlement Restaurant',
      ownerName: 'Owner',
      phone: '9877400001',
      password: await hashPassword('VendorPass123'),
      address: 'Somewhere',
      latitude: 18,
      longitude: 18,
      status: 'ACTIVE',
      approvalStatus: 'APPROVED',
      isOpen: true,
    });
    vendorId = vendor.id;
    vendorToken = (await request(app).post('/api/v1/auth/vendor/login').send({ identifier: '9877400001', password: 'VendorPass123' })).body.data.accessToken;

    const sendOtp = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9877400050' });
    const verify = await request(app)
      .post('/api/v1/auth/customer/verify-otp')
      .send({ phone: '9877400050', otp: sendOtp.body.data.devOtp });
    customerToken = verify.body.data.accessToken;
    const customerId = verify.body.data.customer._id;

    const addressRes = await request(app)
      .post(`/api/v1/customers/${customerId}/addresses`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ locationId, address: '1 Settlement Lane', pincode: '110055', latitude: 18, longitude: 18 });
    addressId = addressRes.body.data._id;

    const category = await FoodCategory.create({ name: 'Settlement Food Category', status: 'ACTIVE' });
    const product = await FoodProduct.create({
      locationId,
      vendorId,
      categoryId: category.id,
      name: 'Settlement Thali',
      price: 200,
      discount: 10, // 10% -> discount 20 on a single unit
      tax: 0,
      isAvailable: true,
      status: 'ACTIVE',
    });
    productId = product.id;

    // 10% GLOBAL commission as the platform default.
    await request(app)
      .post('/api/v1/commissions')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ level: 'GLOBAL', type: 'PERCENTAGE', value: 10 });
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  it('rejects a FOOD_ADMIN (no SETTLEMENT_PROCESS) from generating settlements', async () => {
    const res = await request(app)
      .post('/api/v1/settlements/generate')
      .set('Authorization', `Bearer ${foodAdminToken}`)
      .send({ payeeType: 'VENDOR', periodStart: '2020-01-01', periodEnd: '2020-01-02' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
  });

  let vendorSettlementId: string;
  let deliveryPartnerId: string;
  let periodStart: string;
  let periodEnd: string;

  it('generates a VENDOR settlement from a DELIVERED order, applying the GLOBAL commission (item revenue only, not delivery fee)', async () => {
    periodStart = new Date().toISOString();
    const { orderId, partnerId } = await deliverOrder();
    deliveryPartnerId = partnerId;
    periodEnd = new Date().toISOString();

    // subtotal = 200 (price) - discount 10% = 20 -> gross item revenue 180.
    // deliveryFee = 30 (subtotal 180 < freeDeliveryAbove 1000).
    const orderRes = await request(app).get(`/api/v1/orders/${orderId}`).set('Authorization', `Bearer ${superAdminToken}`);
    expect(orderRes.body.data.subtotal).toBe(200);
    expect(orderRes.body.data.discount).toBe(20);
    expect(orderRes.body.data.deliveryFee).toBe(30);

    const res = await request(app)
      .post('/api/v1/settlements/generate')
      .set('Authorization', `Bearer ${financeAdminToken}`)
      .send({ payeeType: 'VENDOR', periodStart, periodEnd, locationId });
    expect(res.status).toBe(201);
    expect(res.body.data.created).toHaveLength(1);

    const settlement = res.body.data.created[0];
    expect(settlement.payeeId).toBe(vendorId);
    expect(settlement.grossAmount).toBe(180); // subtotal - discount, delivery fee excluded
    expect(settlement.commissionAmount).toBeCloseTo(18, 2); // 10% of 180
    expect(settlement.netAmount).toBeCloseTo(162, 2);
    expect(settlement.status).toBe('PENDING');
    expect(settlement.orderIds).toContain(orderId);
    vendorSettlementId = settlement._id;
  });

  it('generates a DELIVERY_PARTNER settlement for the same period, earning the full delivery fee with no commission', async () => {
    const res = await request(app)
      .post('/api/v1/settlements/generate')
      .set('Authorization', `Bearer ${financeAdminToken}`)
      .send({ payeeType: 'DELIVERY_PARTNER', periodStart, periodEnd, locationId });
    expect(res.status).toBe(201);
    expect(res.body.data.created).toHaveLength(1);

    const settlement = res.body.data.created[0];
    expect(settlement.payeeId).toBe(deliveryPartnerId);
    expect(settlement.grossAmount).toBe(30);
    expect(settlement.commissionAmount).toBe(0);
    expect(settlement.netAmount).toBe(30);
  });

  it('skips regenerating a settlement for the same payee when the period overlaps an existing one', async () => {
    const res = await request(app)
      .post('/api/v1/settlements/generate')
      .set('Authorization', `Bearer ${financeAdminToken}`)
      .send({ payeeType: 'VENDOR', periodStart, periodEnd, locationId });
    expect(res.status).toBe(201);
    expect(res.body.data.created).toHaveLength(0);
    expect(res.body.data.skipped).toHaveLength(1);
    expect(res.body.data.skipped[0].payeeId).toBe(vendorId);
  });

  it('applies a VENDOR-specific commission override instead of the GLOBAL default for a later, non-overlapping period', async () => {
    await request(app)
      .post('/api/v1/commissions')
      .set('Authorization', `Bearer ${financeAdminToken}`)
      .send({ level: 'VENDOR', vendorId, businessType: 'FOOD', type: 'PERCENTAGE', value: 25 });

    const secondPeriodStart = periodEnd; // starts exactly where the first period ended
    const { orderId } = await deliverOrder();
    const secondPeriodEnd = new Date().toISOString();

    const res = await request(app)
      .post('/api/v1/settlements/generate')
      .set('Authorization', `Bearer ${financeAdminToken}`)
      .send({ payeeType: 'VENDOR', periodStart: secondPeriodStart, periodEnd: secondPeriodEnd, locationId });
    expect(res.status).toBe(201);
    const settlement = res.body.data.created[0];
    expect(settlement.orderIds).toContain(orderId);
    expect(settlement.commissionAmount).toBeCloseTo(180 * 0.25, 2); // 25% override, not the 10% GLOBAL rate
  });

  it('lets finance edit adjustments only while PENDING, recomputing netAmount', async () => {
    const res = await request(app)
      .patch(`/api/v1/settlements/${vendorSettlementId}/adjustments`)
      .set('Authorization', `Bearer ${financeAdminToken}`)
      .send({ adjustments: -5 });
    expect(res.status).toBe(200);
    expect(res.body.data.netAmount).toBeCloseTo(180 - 18 - 5, 2);
  });

  it("rejects marking a PENDING settlement paid before it's been processed", async () => {
    const res = await request(app)
      .post(`/api/v1/settlements/${vendorSettlementId}/pay`)
      .set('Authorization', `Bearer ${financeAdminToken}`)
      .send({ transactionReference: 'TXN-EARLY' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SETTLEMENT_NOT_PROCESSING');
  });

  it('walks a settlement PENDING -> PROCESSING -> PAID', async () => {
    const processRes = await request(app)
      .post(`/api/v1/settlements/${vendorSettlementId}/process`)
      .set('Authorization', `Bearer ${financeAdminToken}`);
    expect(processRes.status).toBe(200);
    expect(processRes.body.data.status).toBe('PROCESSING');

    const adjustAfterProcessing = await request(app)
      .patch(`/api/v1/settlements/${vendorSettlementId}/adjustments`)
      .set('Authorization', `Bearer ${financeAdminToken}`)
      .send({ adjustments: 0 });
    expect(adjustAfterProcessing.status).toBe(400);
    expect(adjustAfterProcessing.body.error.code).toBe('SETTLEMENT_NOT_PENDING');

    const payRes = await request(app)
      .post(`/api/v1/settlements/${vendorSettlementId}/pay`)
      .set('Authorization', `Bearer ${financeAdminToken}`)
      .send({ transactionReference: 'TXN-12345' });
    expect(payRes.status).toBe(200);
    expect(payRes.body.data.status).toBe('PAID');
    expect(payRes.body.data.transactionReference).toBe('TXN-12345');
    expect(payRes.body.data.paidAt).toBeTruthy();
  });

  it('lets the vendor view their own settlements but not another payee\'s', async () => {
    const ownRes = await request(app)
      .get(`/api/v1/settlements/${vendorSettlementId}`)
      .set('Authorization', `Bearer ${vendorToken}`);
    expect(ownRes.status).toBe(200);

    const listRes = await request(app).get('/api/v1/settlements').set('Authorization', `Bearer ${vendorToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.every((s: { payeeId: string }) => s.payeeId === vendorId)).toBe(true);
  });

  it("rejects a delivery partner from viewing a vendor's settlement", async () => {
    const { token: otherPartnerToken } = await createOnlinePartner('9877400099');
    const res = await request(app)
      .get(`/api/v1/settlements/${vendorSettlementId}`)
      .set('Authorization', `Bearer ${otherPartnerToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SETTLEMENT_FORBIDDEN');
  });
});
