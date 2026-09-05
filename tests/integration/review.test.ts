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

describe('Reviews: eligibility, target validation, moderation, and rating aggregation', () => {
  let locationId: string;
  let superAdminToken: string;
  let supportToken: string;
  let foodAdminToken: string; // no REVIEW_MODERATE
  let vendorId: string;
  let productId: string;
  let customerAToken: string;
  let customerBToken: string;
  let addressAId: string;
  let addressBId: string;

  async function newCustomerWithAddress(phone: string) {
    const sendOtp = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone });
    const verify = await request(app).post('/api/v1/auth/customer/verify-otp').send({ phone, otp: sendOtp.body.data.devOtp });
    const token = verify.body.data.accessToken;
    const customerId = verify.body.data.customer._id;
    const addressRes = await request(app)
      .post(`/api/v1/customers/${customerId}/addresses`)
      .set('Authorization', `Bearer ${token}`)
      .send({ locationId, address: `${phone} Lane`, pincode: '110099', latitude: 23, longitude: 23 });
    return { token, customerId, addressId: addressRes.body.data._id as string };
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
    await request(app).post(`/api/v1/delivery-partners/${partnerId}/location`).set('Authorization', `Bearer ${token}`).send({ latitude: 23, longitude: 23 });
    await request(app).patch(`/api/v1/delivery-partners/${partnerId}/availability`).set('Authorization', `Bearer ${token}`).send({ availability: 'ONLINE' });
    return { partnerId, token };
  }

  // Places, ready-for-pickups, assigns, and fully delivers a FOOD order for
  // the given customer/address, returning everything a review needs.
  async function deliverOrderFor(customerToken: string, forAddressId: string) {
    const createRes = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ businessType: 'FOOD', vendorId, addressId: forAddressId, paymentMethod: 'COD', items: [{ productId, quantity: 1, addons: [] }] });
    const orderId = createRes.body.data._id;

    // Vendor moves it through the pre-pickup pipeline.
    const vendorToken = (await request(app).post('/api/v1/auth/vendor/login').send({ identifier: '9877000010', password: 'VendorPass123' })).body.data.accessToken;
    for (const status of ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP']) {
      await request(app).patch(`/api/v1/orders/${orderId}/status`).set('Authorization', `Bearer ${vendorToken}`).send({ status });
    }

    const partnerPhone = `98771${Math.floor(10000 + Math.random() * 89999)}`;
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

    const location = await Location.create({ name: 'Review City', code: 'REVIEWCITY', state: 'UP', district: 'D1', latitude: 23, longitude: 23, serviceRadius: 20 });
    locationId = location.id;

    await DeliveryZone.create({
      locationId,
      name: 'Review Zone',
      centerLatitude: 23,
      centerLongitude: 23,
      radius: 15,
      deliveryFee: 20,
      freeDeliveryAbove: 1000,
      estimatedDeliveryTime: 30,
      status: 'ACTIVE',
    });

    const password = await hashPassword('Password123');
    await AdminUser.create({ name: 'Super', email: 'rv.super@example.com', password, role: 'SUPER_ADMIN', locationIds: [] });
    await AdminUser.create({ name: 'Support', email: 'rv.support@example.com', password, role: 'SUPPORT_ADMIN', locationIds: [] });
    await AdminUser.create({ name: 'Food', email: 'rv.food@example.com', password, role: 'FOOD_ADMIN', locationIds: [] });
    superAdminToken = (await request(app).post('/api/v1/auth/admin/login').send({ email: 'rv.super@example.com', password: 'Password123' })).body.data.accessToken;
    supportToken = (await request(app).post('/api/v1/auth/admin/login').send({ email: 'rv.support@example.com', password: 'Password123' })).body.data.accessToken;
    foodAdminToken = (await request(app).post('/api/v1/auth/admin/login').send({ email: 'rv.food@example.com', password: 'Password123' })).body.data.accessToken;

    const vendor = await Vendor.create({
      locationId,
      restaurantName: 'Review Restaurant',
      ownerName: 'Owner',
      phone: '9877000010',
      password: await hashPassword('VendorPass123'),
      address: 'Somewhere',
      latitude: 23,
      longitude: 23,
      status: 'ACTIVE',
      approvalStatus: 'APPROVED',
      isOpen: true,
    });
    vendorId = vendor.id;

    const category = await FoodCategory.create({ name: 'Review Food Category', status: 'ACTIVE' });
    const product = await FoodProduct.create({ locationId, vendorId, categoryId: category.id, name: 'Review Thali', price: 150, isAvailable: true, status: 'ACTIVE' });
    productId = product.id;

    const custA = await newCustomerWithAddress('9877000050');
    customerAToken = custA.token;
    addressAId = custA.addressId;

    const custB = await newCustomerWithAddress('9877000051');
    customerBToken = custB.token;
    addressBId = custB.addressId;
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  it('rejects reviewing an order that has not been delivered yet', async () => {
    const createRes = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ businessType: 'FOOD', vendorId, addressId: addressAId, paymentMethod: 'COD', items: [{ productId, quantity: 1, addons: [] }] });

    const res = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ orderId: createRes.body.data._id, targetType: 'VENDOR', targetId: vendorId, rating: 5 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ORDER_NOT_DELIVERED');
  });

  let orderAId: string;
  let deliveryPartnerAId: string;

  it('rejects a target that was not actually part of the order', async () => {
    const delivered = await deliverOrderFor(customerAToken, addressAId);
    orderAId = delivered.orderId;
    deliveryPartnerAId = delivered.partnerId;

    const res = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ orderId: orderAId, targetType: 'STORE', targetId: '507f1f77bcf86cd799439011', rating: 3 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('REVIEW_TARGET_MISMATCH');
  });

  it("rejects a customer reviewing another customer's order", async () => {
    const res = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customerBToken}`)
      .send({ orderId: orderAId, targetType: 'VENDOR', targetId: vendorId, rating: 5 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ORDER_FORBIDDEN');
  });

  let vendorReviewAId: string;

  it('creates a VENDOR review, updating the vendor\'s aggregate rating', async () => {
    const res = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ orderId: orderAId, targetType: 'VENDOR', targetId: vendorId, rating: 4, comment: 'Pretty good' });
    expect(res.status).toBe(201);
    vendorReviewAId = res.body.data._id;

    const vendor = await Vendor.findById(vendorId);
    expect(vendor?.rating).toBe(4);
    expect(vendor?.ratingCount).toBe(1);
  });

  it('creates a PRODUCT review for the item actually ordered', async () => {
    const res = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ orderId: orderAId, targetType: 'PRODUCT', targetId: productId, rating: 5 });
    expect(res.status).toBe(201);
  });

  it('creates a DELIVERY_PARTNER review', async () => {
    const res = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ orderId: orderAId, targetType: 'DELIVERY_PARTNER', targetId: deliveryPartnerAId, rating: 5 });
    expect(res.status).toBe(201);

    const partnerRes = await request(app).get(`/api/v1/delivery-partners/${deliveryPartnerAId}`).set('Authorization', `Bearer ${superAdminToken}`);
    expect(partnerRes.body.data.rating).toBe(5);
  });

  it('rejects reviewing the same target twice for the same order', async () => {
    const res = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ orderId: orderAId, targetType: 'VENDOR', targetId: vendorId, rating: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REVIEW_ALREADY_EXISTS');
  });

  it('averages ratings across multiple customers for the same vendor', async () => {
    const delivered = await deliverOrderFor(customerBToken, addressBId);
    const res = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customerBToken}`)
      .send({ orderId: delivered.orderId, targetType: 'VENDOR', targetId: vendorId, rating: 2 });
    expect(res.status).toBe(201);

    // (4 + 2) / 2 = 3
    const vendor = await Vendor.findById(vendorId);
    expect(vendor?.rating).toBe(3);
    expect(vendor?.ratingCount).toBe(2);
  });

  it('public GET /reviews returns only VISIBLE reviews for a target, no auth required', async () => {
    const res = await request(app).get('/api/v1/reviews').query({ targetType: 'VENDOR', targetId: vendorId });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('rejects a FOOD_ADMIN (no REVIEW_MODERATE) from hiding a review', async () => {
    const res = await request(app)
      .patch(`/api/v1/reviews/${vendorReviewAId}/status`)
      .set('Authorization', `Bearer ${foodAdminToken}`)
      .send({ status: 'HIDDEN' });
    expect(res.status).toBe(403);
  });

  it('lets a SUPPORT_ADMIN hide a review, recomputing the vendor rating to exclude it', async () => {
    const res = await request(app)
      .patch(`/api/v1/reviews/${vendorReviewAId}/status`)
      .set('Authorization', `Bearer ${supportToken}`)
      .send({ status: 'HIDDEN' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('HIDDEN');

    // Only the rating=2 review is VISIBLE now.
    const vendor = await Vendor.findById(vendorId);
    expect(vendor?.rating).toBe(2);
    expect(vendor?.ratingCount).toBe(1);

    const publicRes = await request(app).get('/api/v1/reviews').query({ targetType: 'VENDOR', targetId: vendorId });
    expect(publicRes.body.data).toHaveLength(1);
  });

  it('hides a HIDDEN review from an anonymous GET /:id (404) but not from its own author', async () => {
    const anonRes = await request(app).get(`/api/v1/reviews/${vendorReviewAId}`);
    expect(anonRes.status).toBe(404);

    const ownerRes = await request(app).get(`/api/v1/reviews/${vendorReviewAId}`).set('Authorization', `Bearer ${customerAToken}`);
    expect(ownerRes.status).toBe(200);

    const supportRes = await request(app).get(`/api/v1/reviews/${vendorReviewAId}`).set('Authorization', `Bearer ${supportToken}`);
    expect(supportRes.status).toBe(200);
  });

  it("rejects a customer editing someone else's review", async () => {
    const res = await request(app)
      .patch(`/api/v1/reviews/${vendorReviewAId}`)
      .set('Authorization', `Bearer ${customerBToken}`)
      .send({ rating: 1 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('REVIEW_FORBIDDEN');
  });

  it('lets the author edit their own review, recomputing the rating again', async () => {
    // Unhide implicitly by re-saving? No — status stays HIDDEN; edit rating value instead
    // and confirm the (still-hidden) review's new rating doesn't affect the vendor
    // aggregate, since it's excluded from the aggregate regardless of value.
    const res = await request(app)
      .patch(`/api/v1/reviews/${vendorReviewAId}`)
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ rating: 5 });
    expect(res.status).toBe(200);
    expect(res.body.data.rating).toBe(5);

    const vendor = await Vendor.findById(vendorId);
    expect(vendor?.ratingCount).toBe(1); // still just the one VISIBLE review
  });

  it("rejects a customer deleting someone else's review, but lets the author delete their own", async () => {
    const forbidden = await request(app)
      .delete(`/api/v1/reviews/${vendorReviewAId}`)
      .set('Authorization', `Bearer ${customerBToken}`);
    expect(forbidden.status).toBe(403);

    const ok = await request(app)
      .delete(`/api/v1/reviews/${vendorReviewAId}`)
      .set('Authorization', `Bearer ${customerAToken}`);
    expect(ok.status).toBe(200);

    const getRes = await request(app).get(`/api/v1/reviews/${vendorReviewAId}`).set('Authorization', `Bearer ${customerAToken}`);
    expect(getRes.status).toBe(404);
  });
});
