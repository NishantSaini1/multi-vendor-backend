import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { AdminUser } from '../../src/models/AdminUser';
import { Location } from '../../src/models/Location';
import { DeliveryZone } from '../../src/models/DeliveryZone';
import { FoodCategory } from '../../src/models/FoodCategory';
import { Vendor } from '../../src/models/Vendor';
import { hashPassword } from '../../src/utils/password';
import { startTestDatabase, stopTestDatabase } from './testServer';
import { createTestVendor, createOrderableFoodItem } from './helpers/foodFixtures';

describe('Coupons: admin CRUD and order-time application', () => {
  let locationId: string;
  let marketingToken: string;
  let customerToken: string;
  let addressId: string;
  let vendorId: string;
  let otherVendorId: string;
  let categoryId: string;
  let productId: string;
  let globalFoodItemId: string;
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
        items: [{ productId: product, quantity: 1, modifiers: [] }],
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

    const vendor = await createTestVendor({
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

    const otherVendor = await createTestVendor({
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
    categoryId = category.id;
    const product = await createOrderableFoodItem(vendorId, categoryId, { name: 'Coupon Thali', price: 250 });
    productId = product.id;
    globalFoodItemId = product.globalFoodItemId.toString();
    const otherProduct = await createOrderableFoodItem(otherVendorId, categoryId, { name: 'Other Thali', price: 250 });
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

  describe('Stage 5: foodItemIds scoping and firstOrderOnly', () => {
    it("rejects a coupon scoped to a different item's global FoodProduct", async () => {
      // otherVendorProductId's VendorFoodItem maps onto a DIFFERENT global
      // FoodProduct than `globalFoodItemId` (each createOrderableFoodItem
      // call makes its own global item) — so scoping to `globalFoodItemId`
      // must reject an order for the other vendor's item.
      await request(app)
        .post('/api/v1/coupons')
        .set('Authorization', `Bearer ${marketingToken}`)
        .send({
          code: 'ITEMONLY',
          discountType: 'FIXED',
          discountValue: 10,
          foodItemIds: [globalFoodItemId],
          startDate: farPastDate(),
          endDate: farFutureDate(),
        });

      const res = await placeOrder(customerToken, otherVendorId, otherVendorProductId, 'ITEMONLY');
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('COUPON_NOT_APPLICABLE');

      // ...but applies to an order containing the item it's actually scoped to.
      const okRes = await placeOrder(customerToken, vendorId, productId, 'ITEMONLY');
      expect(okRes.status).toBe(201);
    });

    it('rejects a firstOrderOnly coupon for a customer who has already placed a (non-cancelled) order', async () => {
      await request(app)
        .post('/api/v1/coupons')
        .set('Authorization', `Bearer ${marketingToken}`)
        .send({
          code: 'FIRSTORDER',
          discountType: 'FIXED',
          discountValue: 10,
          firstOrderOnly: true,
          startDate: farPastDate(),
          endDate: farFutureDate(),
        });

      // `customerToken` already placed several orders earlier in this file.
      const res = await placeOrder(customerToken, vendorId, productId, 'FIRSTORDER');
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('COUPON_FIRST_ORDER_ONLY');
    });

    it('accepts a firstOrderOnly coupon for a brand-new customer with no prior orders', async () => {
      const sendOtp = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9877300088' });
      const verify = await request(app).post('/api/v1/auth/customer/verify-otp').send({ phone: '9877300088', otp: sendOtp.body.data.devOtp });
      const newCustomerToken = verify.body.data.accessToken;
      const newCustomerId = verify.body.data.customer._id;
      const newAddressRes = await request(app)
        .post(`/api/v1/customers/${newCustomerId}/addresses`)
        .set('Authorization', `Bearer ${newCustomerToken}`)
        .send({ locationId, address: 'First Order Lane', pincode: '110036', latitude: 19, longitude: 19 });

      const res = await placeOrder(newCustomerToken, vendorId, productId, 'FIRSTORDER', newAddressRes.body.data._id);
      expect(res.status).toBe(201);
      expect(res.body.data.couponDiscount).toBe(10);
    });
  });

  describe('POST /coupons/preview', () => {
    function preview(token: string, body: Record<string, unknown>) {
      return request(app)
        .post('/api/v1/coupons/preview')
        .set('Authorization', `Bearer ${token}`)
        .send({ locationId, businessType: 'FOOD', vendorId, subtotal: 250, ...body });
    }

    it('returns the discount the order would get, using the same math as order creation', async () => {
      await request(app)
        .post('/api/v1/coupons')
        .set('Authorization', `Bearer ${marketingToken}`)
        .send({ code: 'PREVIEW40', discountType: 'PERCENTAGE', discountValue: 40, maximumDiscount: 60, startDate: farPastDate(), endDate: farFutureDate() });

      const res = await preview(customerToken, { code: 'preview40' });
      expect(res.status).toBe(200);
      // 40% of 250 = 100, capped at 60.
      expect(res.body.data.code).toBe('PREVIEW40');
      expect(res.body.data.discount).toBe(60);
      expect(res.body.data.subtotalAfterDiscount).toBe(190);
    });

    it('never consumes a use', async () => {
      await request(app)
        .post('/api/v1/coupons')
        .set('Authorization', `Bearer ${marketingToken}`)
        .send({ code: 'PEEKONCE', discountType: 'FIXED', discountValue: 15, usageLimit: 1, startDate: farPastDate(), endDate: farFutureDate() });

      for (let i = 0; i < 3; i += 1) {
        const res = await preview(customerToken, { code: 'PEEKONCE' });
        expect(res.status).toBe(200);
      }
      // ...so the single real use is still available for an actual order.
      const order = await placeOrder(customerToken, vendorId, productId, 'PEEKONCE');
      expect(order.status).toBe(201);
      expect(order.body.data.couponDiscount).toBe(15);
    });

    it('rejects with the same error codes order creation uses', async () => {
      const notFound = await preview(customerToken, { code: 'NOPE123' });
      expect(notFound.status).toBe(404);
      expect(notFound.body.error.code).toBe('COUPON_NOT_FOUND');

      const minimum = await preview(customerToken, { code: 'BIGORDER' });
      expect(minimum.status).toBe(422);
      expect(minimum.body.error.code).toBe('COUPON_MINIMUM_ORDER_NOT_MET');

      const otherVendor = await preview(customerToken, { code: 'OTHERVENDOR' });
      expect(otherVendor.status).toBe(422);
      expect(otherVendor.body.error.code).toBe('COUPON_NOT_APPLICABLE');
    });

    it('requires a customer token', async () => {
      const res = await request(app)
        .post('/api/v1/coupons/preview')
        .send({ code: 'PREVIEW40', locationId, businessType: 'FOOD', subtotal: 250 });
      expect(res.status).toBe(401);
    });
  });

  describe('vendor-run coupons/offers and vendor-type targeting', () => {
    let vendorToken: string;
    let otherVendorToken: string;
    let vendorCouponId: string;

    const preview = (code: string, forVendorId: string) =>
      request(app)
        .post('/api/v1/coupons/preview')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ code, locationId, businessType: 'FOOD', vendorId: forVendorId, subtotal: 250 });

    beforeAll(async () => {
      vendorToken = (await request(app).post('/api/v1/auth/vendor/login').send({ identifier: '9877300001', password: 'VendorPass123' })).body.data.accessToken;
      otherVendorToken = (await request(app).post('/api/v1/auth/vendor/login').send({ identifier: '9877300002', password: 'VendorPass123' })).body.data.accessToken;
    });

    it("lets a vendor create its own coupon, locked to itself whatever scoping it sends", async () => {
      const res = await request(app)
        .post('/api/v1/coupons')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          code: 'MYREST15',
          discountType: 'PERCENTAGE',
          discountValue: 15,
          vendorIds: [otherVendorId],
          businessTypes: ['INSTAMART'],
          startDate: farPastDate(),
          endDate: farFutureDate(),
        });
      expect(res.status).toBe(201);
      expect(res.body.data.ownerType).toBe('VENDOR');
      expect(res.body.data.ownerId).toBe(vendorId);
      expect(res.body.data.vendorIds).toEqual([vendorId]);
      expect(res.body.data.businessTypes).toEqual(['FOOD']);
      vendorCouponId = res.body.data._id;
    });

    it("applies only at that vendor's restaurant", async () => {
      expect((await preview('MYREST15', vendorId)).status).toBe(200);
      const other = await preview('MYREST15', otherVendorId);
      expect(other.status).toBe(422);
      expect(other.body.error.code).toBe('COUPON_NOT_APPLICABLE');
    });

    it('lists only its own coupons for a vendor, and blocks another vendor from managing it', async () => {
      const mine = await request(app).get('/api/v1/coupons').set('Authorization', `Bearer ${vendorToken}`);
      expect(mine.status).toBe(200);
      expect(mine.body.data.map((c: { code: string }) => c.code)).toEqual(['MYREST15']);

      const othersList = await request(app).get('/api/v1/coupons').set('Authorization', `Bearer ${otherVendorToken}`);
      expect(othersList.body.data).toHaveLength(0);

      const patch = await request(app)
        .patch(`/api/v1/coupons/${vendorCouponId}`)
        .set('Authorization', `Bearer ${otherVendorToken}`)
        .send({ discountValue: 90 });
      expect(patch.status).toBe(403);
      expect(patch.body.error.code).toBe('PROMOTION_FORBIDDEN');
      const del = await request(app).delete(`/api/v1/coupons/${vendorCouponId}`).set('Authorization', `Bearer ${otherVendorToken}`);
      expect(del.status).toBe(403);
    });

    it("lets the owning vendor edit and pause it, but never widen its scope", async () => {
      const patch = await request(app)
        .patch(`/api/v1/coupons/${vendorCouponId}`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ discountValue: 10, vendorIds: [otherVendorId] });
      expect(patch.status).toBe(200);
      expect(patch.body.data.discountValue).toBe(10);
      expect(patch.body.data.vendorIds).toEqual([vendorId]);

      const pause = await request(app)
        .patch(`/api/v1/coupons/${vendorCouponId}/status`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ status: 'INACTIVE' });
      expect(pause.status).toBe(200);
      expect((await preview('MYREST15', vendorId)).body.error.code).toBe('COUPON_NOT_ACTIVE');
    });

    it('lets an admin see and manage vendor-run coupons', async () => {
      const list = await request(app).get('/api/v1/coupons').query({ ownerType: 'VENDOR' }).set('Authorization', `Bearer ${marketingToken}`);
      expect(list.body.data.map((c: { code: string }) => c.code)).toContain('MYREST15');
      const reactivate = await request(app)
        .patch(`/api/v1/coupons/${vendorCouponId}/status`)
        .set('Authorization', `Bearer ${marketingToken}`)
        .send({ status: 'ACTIVE' });
      expect(reactivate.status).toBe(200);
    });

    it('scopes an admin coupon to a vendor TYPE', async () => {
      const vendor = await Vendor.findById(vendorId);
      const create = await request(app)
        .post('/api/v1/coupons')
        .set('Authorization', `Bearer ${marketingToken}`)
        .send({
          code: 'TYPEWISE25',
          discountType: 'FIXED',
          discountValue: 25,
          vendorTypeIds: [vendor!.vendorTypeIds[0].toString()],
          startDate: farPastDate(),
          endDate: farFutureDate(),
        });
      expect(create.status).toBe(201);
      expect(create.body.data.ownerType).toBe('PLATFORM');

      expect((await preview('TYPEWISE25', vendorId)).status).toBe(200);
      expect((await preview('TYPEWISE25', otherVendorId)).body.error.code).toBe('COUPON_NOT_APPLICABLE');

      const activeFor = async (forVendorId: string) =>
        (
          await request(app)
            .get('/api/v1/coupons/active')
            .query({ locationId, businessType: 'FOOD', vendorId: forVendorId })
            .set('Authorization', `Bearer ${customerToken}`)
        ).body.data.map((c: { code: string }) => c.code);
      expect(await activeFor(vendorId)).toEqual(expect.arrayContaining(['TYPEWISE25', 'MYREST15']));
      expect(await activeFor(otherVendorId)).not.toContain('TYPEWISE25');
      expect(await activeFor(otherVendorId)).not.toContain('MYREST15');

      // The vendor can see platform coupons that apply to it (read-only).
      const platform = await request(app).get('/api/v1/coupons').query({ scope: 'platform' }).set('Authorization', `Bearer ${vendorToken}`);
      expect(platform.body.data.map((c: { code: string }) => c.code)).toContain('TYPEWISE25');
      const otherPlatform = await request(app).get('/api/v1/coupons').query({ scope: 'platform' }).set('Authorization', `Bearer ${otherVendorToken}`);
      expect(otherPlatform.body.data.map((c: { code: string }) => c.code)).not.toContain('TYPEWISE25');
    });

    it("lets a vendor run its own display offer, shown only on its restaurant", async () => {
      const create = await request(app)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ title: 'Free dessert above 499', discountType: 'FIXED', discountValue: 50, vendorIds: [otherVendorId], startDate: farPastDate(), endDate: farFutureDate() });
      expect(create.status).toBe(201);
      expect(create.body.data.ownerType).toBe('VENDOR');
      expect(create.body.data.vendorIds).toEqual([vendorId]);
      expect(create.body.data.businessType).toBe('FOOD');

      const titlesFor = async (forVendorId: string) =>
        (await request(app).get('/api/v1/offers/active').query({ vendorId: forVendorId })).body.data.map((o: { title: string }) => o.title);
      expect(await titlesFor(vendorId)).toContain('Free dessert above 499');
      expect(await titlesFor(otherVendorId)).not.toContain('Free dessert above 499');

      const otherPatch = await request(app)
        .patch(`/api/v1/offers/${create.body.data._id}`)
        .set('Authorization', `Bearer ${otherVendorToken}`)
        .send({ title: 'hijacked' });
      expect(otherPatch.status).toBe(403);
    });

    it('still keeps customers out of coupon management', async () => {
      const res = await request(app).get('/api/v1/coupons').set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(403);
    });
  });
});
