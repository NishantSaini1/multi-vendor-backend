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

describe('Coupons: admin CRUD and order-time application', () => {
  let locationId: string;
  let marketingToken: string;
  let customerToken: string;
  let addressId: string;
  let vendorId: string;
  let otherVendorId: string;
  let productId: string;
  let otherVendorProductId: string;

  function farPastDate() {
    return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  }
  function farFutureDate() {
    return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  }

  async function placeOrder(token: string, vendor: string, product: string, couponCode?: string, forAddressId: string = addressId) {
    return request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        businessType: 'FOOD',
        vendorId: vendor,
        addressId: forAddressId,
        paymentMethod: 'COD',
        items: [{ productId: product, quantity: 1, addons: [] }],
        ...(couponCode ? { couponCode } : {}),
      });
  }

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();

    const location = await Location.create({ name: 'Coupon City', code: 'COUPONCITY', state: 'UP', district: 'D1', latitude: 19, longitude: 19, serviceRadius: 20 });
    locationId = location.id;

    await DeliveryZone.create({
      locationId,
      name: 'Coupon Zone',
      centerLatitude: 19,
      centerLongitude: 19,
      radius: 10,
      deliveryFee: 20,
      freeDeliveryAbove: 1000,
      estimatedDeliveryTime: 30,
      status: 'ACTIVE',
    });

    const password = await hashPassword('Password123');
    await AdminUser.create({ name: 'Marketing', email: 'cp.marketing@example.com', password, role: 'MARKETING_ADMIN', locationIds: [] });
    marketingToken = (await request(app).post('/api/v1/auth/admin/login').send({ email: 'cp.marketing@example.com', password: 'Password123' })).body.data.accessToken;

    const vendor = await Vendor.create({
      locationId,
      restaurantName: 'Coupon Restaurant',
      ownerName: 'Owner',
      phone: '9877300001',
      password: await hashPassword('VendorPass123'),
      address: 'Somewhere',
      latitude: 19,
      longitude: 19,
      status: 'ACTIVE',
      approvalStatus: 'APPROVED',
      isOpen: true,
    });
    vendorId = vendor.id;

    const otherVendor = await Vendor.create({
      locationId,
      restaurantName: 'Other Coupon Restaurant',
      ownerName: 'Owner',
      phone: '9877300002',
      password: await hashPassword('VendorPass123'),
      address: 'Elsewhere',
      latitude: 19,
      longitude: 19,
      status: 'ACTIVE',
      approvalStatus: 'APPROVED',
      isOpen: true,
    });
    otherVendorId = otherVendor.id;

    const category = await FoodCategory.create({ name: 'Coupon Food Category', status: 'ACTIVE' });
    const product = await FoodProduct.create({ locationId, vendorId, categoryId: category.id, name: 'Coupon Thali', price: 250, discount: 0, tax: 0, isAvailable: true, status: 'ACTIVE' });
    productId = product.id;
    const otherProduct = await FoodProduct.create({ locationId, vendorId: otherVendorId, categoryId: category.id, name: 'Other Thali', price: 250, discount: 0, tax: 0, isAvailable: true, status: 'ACTIVE' });
    otherVendorProductId = otherProduct.id;

    const sendOtp = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9877300050' });
    const verify = await request(app).post('/api/v1/auth/customer/verify-otp').send({ phone: '9877300050', otp: sendOtp.body.data.devOtp });
    customerToken = verify.body.data.accessToken;
    const customerId = verify.body.data.customer._id;

    const addressRes = await request(app)
      .post(`/api/v1/customers/${customerId}/addresses`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ locationId, address: '1 Coupon Lane', pincode: '110033', latitude: 19, longitude: 19 });
    addressId = addressRes.body.data._id;
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  it('rejects checkout with an unknown coupon code', async () => {
    const res = await placeOrder(customerToken, vendorId, productId, 'DOESNOTEXIST');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COUPON_NOT_FOUND');
  });

  let save20Id: string;

  it('lets a MARKETING_ADMIN create a coupon', async () => {
    const res = await request(app)
      .post('/api/v1/coupons')
      .set('Authorization', `Bearer ${marketingToken}`)
      .send({
        code: 'save20',
        discountType: 'PERCENTAGE',
        discountValue: 20,
        minimumOrder: 0,
        usageLimit: 5,
        perUserLimit: 1,
        startDate: farPastDate(),
        endDate: farFutureDate(),
      });
    expect(res.status).toBe(201);
    expect(res.body.data.code).toBe('SAVE20'); // stored uppercase
    save20Id = res.body.data._id;
  });

  it('rejects creating a duplicate coupon code', async () => {
    const res = await request(app)
      .post('/api/v1/coupons')
      .set('Authorization', `Bearer ${marketingToken}`)
      .send({ code: 'SAVE20', discountType: 'FIXED', discountValue: 10, startDate: farPastDate(), endDate: farFutureDate() });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COUPON_CODE_EXISTS');
  });

  it('rejects checkout below a coupon\'s minimumOrder', async () => {
    await request(app)
      .post('/api/v1/coupons')
      .set('Authorization', `Bearer ${marketingToken}`)
      .send({ code: 'BIGORDER', discountType: 'FIXED', discountValue: 10, minimumOrder: 500, startDate: farPastDate(), endDate: farFutureDate() });

    const res = await placeOrder(customerToken, vendorId, productId, 'BIGORDER'); // subtotal 250 < 500
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('COUPON_MINIMUM_ORDER_NOT_MET');
  });

  it('rejects an expired coupon', async () => {
    await request(app)
      .post('/api/v1/coupons')
      .set('Authorization', `Bearer ${marketingToken}`)
      .send({ code: 'EXPIRED', discountType: 'FIXED', discountValue: 10, startDate: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), endDate: farPastDate() });

    const res = await placeOrder(customerToken, vendorId, productId, 'EXPIRED');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('COUPON_EXPIRED');
  });

  it('rejects an INACTIVE coupon', async () => {
    const created = await request(app)
      .post('/api/v1/coupons')
      .set('Authorization', `Bearer ${marketingToken}`)
      .send({ code: 'DISABLED', discountType: 'FIXED', discountValue: 10, startDate: farPastDate(), endDate: farFutureDate() });
    await request(app)
      .patch(`/api/v1/coupons/${created.body.data._id}/status`)
      .set('Authorization', `Bearer ${marketingToken}`)
      .send({ status: 'INACTIVE' });

    const res = await placeOrder(customerToken, vendorId, productId, 'DISABLED');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('COUPON_NOT_ACTIVE');
  });

  it("rejects a coupon scoped to a different vendor", async () => {
    await request(app)
      .post('/api/v1/coupons')
      .set('Authorization', `Bearer ${marketingToken}`)
      .send({ code: 'OTHERVENDOR', discountType: 'FIXED', discountValue: 10, vendorIds: [otherVendorId], startDate: farPastDate(), endDate: farFutureDate() });

    const res = await placeOrder(customerToken, vendorId, productId, 'OTHERVENDOR');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('COUPON_NOT_APPLICABLE');

    // ...but it works for the vendor it's actually scoped to.
    const okRes = await placeOrder(customerToken, otherVendorId, otherVendorProductId, 'OTHERVENDOR');
    expect(okRes.status).toBe(201);
  });

  it('caps a PERCENTAGE discount at maximumDiscount', async () => {
    await request(app)
      .post('/api/v1/coupons')
      .set('Authorization', `Bearer ${marketingToken}`)
      .send({ code: 'CAPPED', discountType: 'PERCENTAGE', discountValue: 50, maximumDiscount: 30, startDate: farPastDate(), endDate: farFutureDate() });

    const res = await placeOrder(customerToken, vendorId, productId, 'CAPPED');
    expect(res.status).toBe(201);
    // 50% of subtotal(250) = 125, capped to 30. total = 250 - 30 + deliveryFee(20) = 240.
    expect(res.body.data.couponDiscount).toBe(30);
    expect(res.body.data.total).toBe(240);
  });

  let firstSave20OrderId: string;

  it('applies a PERCENTAGE coupon end-to-end, computing couponDiscount and total server-side', async () => {
    const res = await placeOrder(customerToken, vendorId, productId, 'SAVE20');
    expect(res.status).toBe(201);
    // subtotal=250, discount=0, tax=0, deliveryFee=20, couponDiscount = 20% of 250 = 50.
    expect(res.body.data.couponCode).toBe('SAVE20');
    expect(res.body.data.couponDiscount).toBe(50);
    expect(res.body.data.total).toBe(250 - 50 + 20);
    firstSave20OrderId = res.body.data._id;

    const couponRes = await request(app).get(`/api/v1/coupons/${save20Id}`).set('Authorization', `Bearer ${marketingToken}`);
    expect(couponRes.body.data.usedCount).toBe(1);
  });

  it('rejects the same customer reusing a perUserLimit=1 coupon', async () => {
    const res = await placeOrder(customerToken, vendorId, productId, 'SAVE20');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('COUPON_PER_USER_LIMIT_REACHED');
  });

  it('lets a different customer use the same coupon', async () => {
    const sendOtp = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9877300099' });
    const verify = await request(app).post('/api/v1/auth/customer/verify-otp').send({ phone: '9877300099', otp: sendOtp.body.data.devOtp });
    const otherCustomerToken = verify.body.data.accessToken;
    const otherCustomerId = verify.body.data.customer._id;
    const otherAddressRes = await request(app)
      .post(`/api/v1/customers/${otherCustomerId}/addresses`)
      .set('Authorization', `Bearer ${otherCustomerToken}`)
      .send({ locationId, address: 'Other Lane', pincode: '110034', latitude: 19, longitude: 19 });

    const res = await placeOrder(otherCustomerToken, vendorId, productId, 'SAVE20', otherAddressRes.body.data._id);
    expect(res.status).toBe(201);
  });

  it("frees up the customer's per-user limit once their earlier order using the coupon is cancelled", async () => {
    const cancelRes = await request(app)
      .post(`/api/v1/orders/${firstSave20OrderId}/cancel`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ reason: 'Changed my mind' });
    expect(cancelRes.status).toBe(200);

    const res = await placeOrder(customerToken, vendorId, productId, 'SAVE20');
    expect(res.status).toBe(201);
  });

  it('enforces the global usageLimit regardless of which customer is using it', async () => {
    await request(app)
      .post('/api/v1/coupons')
      .set('Authorization', `Bearer ${marketingToken}`)
      .send({ code: 'LIMIT1', discountType: 'FIXED', discountValue: 10, usageLimit: 1, perUserLimit: 5, startDate: farPastDate(), endDate: farFutureDate() });

    const first = await placeOrder(customerToken, vendorId, productId, 'LIMIT1');
    expect(first.status).toBe(201);

    const sendOtp = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9877300077' });
    const verify = await request(app).post('/api/v1/auth/customer/verify-otp').send({ phone: '9877300077', otp: sendOtp.body.data.devOtp });
    const anotherCustomerToken = verify.body.data.accessToken;
    const anotherCustomerId = verify.body.data.customer._id;
    const anotherAddressRes = await request(app)
      .post(`/api/v1/customers/${anotherCustomerId}/addresses`)
      .set('Authorization', `Bearer ${anotherCustomerToken}`)
      .send({ locationId, address: 'Another Lane', pincode: '110035', latitude: 19, longitude: 19 });

    const second = await placeOrder(anotherCustomerToken, vendorId, productId, 'LIMIT1', anotherAddressRes.body.data._id);
    expect(second.status).toBe(422);
    expect(second.body.error.code).toBe('COUPON_USAGE_LIMIT_REACHED');
  });

  it('deletes a coupon', async () => {
    const res = await request(app).delete(`/api/v1/coupons/${save20Id}`).set('Authorization', `Bearer ${marketingToken}`);
    expect(res.status).toBe(200);
    const getRes = await request(app).get(`/api/v1/coupons/${save20Id}`).set('Authorization', `Bearer ${marketingToken}`);
    expect(getRes.status).toBe(404);
  });
});
