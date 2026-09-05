import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { AdminUser } from '../../src/models/AdminUser';
import { Location } from '../../src/models/Location';
import { DeliveryZone } from '../../src/models/DeliveryZone';
import { Vendor } from '../../src/models/Vendor';
import { Store } from '../../src/models/Store';
import { FoodCategory } from '../../src/models/FoodCategory';
import { FoodProduct } from '../../src/models/FoodProduct';
import { FoodVariant } from '../../src/models/FoodVariant';
import { FoodAddon } from '../../src/models/FoodAddon';
import { InstamartCategory } from '../../src/models/InstamartCategory';
import { InstamartProduct } from '../../src/models/InstamartProduct';
import { Inventory } from '../../src/models/Inventory';
import { hashPassword } from '../../src/utils/password';
import { startTestDatabase, stopTestDatabase } from './testServer';

describe('Orders: pricing, inventory reservation, status machine, cancellation', () => {
  let locationId: string;
  let superAdminToken: string;
  let customerToken: string;
  let addressId: string;

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();

    const location = await Location.create({
      name: 'Order City',
      code: 'ORDERCITY',
      state: 'UP',
      district: 'D1',
      latitude: 15,
      longitude: 15,
      serviceRadius: 20,
    });
    locationId = location.id;

    await DeliveryZone.create({
      locationId,
      name: 'Order Zone',
      centerLatitude: 15,
      centerLongitude: 15,
      radius: 10,
      deliveryFee: 30,
      freeDeliveryAbove: 500,
      estimatedDeliveryTime: 40,
      status: 'ACTIVE',
    });

    const adminPassword = await hashPassword('Password123');
    await AdminUser.create({ name: 'Super', email: 'o.super@example.com', password: adminPassword, role: 'SUPER_ADMIN', locationIds: [] });
    superAdminToken = (
      await request(app).post('/api/v1/auth/admin/login').send({ email: 'o.super@example.com', password: 'Password123' })
    ).body.data.accessToken;

    const sendOtp = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9877700001' });
    const verify = await request(app)
      .post('/api/v1/auth/customer/verify-otp')
      .send({ phone: '9877700001', otp: sendOtp.body.data.devOtp });
    customerToken = verify.body.data.accessToken;
    const customerId = verify.body.data.customer._id;

    const addressRes = await request(app)
      .post(`/api/v1/customers/${customerId}/addresses`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ locationId, address: '1 Order Lane', pincode: '110099', latitude: 15, longitude: 15 });
    addressId = addressRes.body.data._id;
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  describe('FOOD orders', () => {
    let vendorId: string;
    let categoryId: string;
    let productId: string;
    let variantId: string;
    let addonId: string;

    beforeAll(async () => {
      const vendor = await Vendor.create({
        locationId,
        restaurantName: 'Order Restaurant',
        ownerName: 'Owner',
        phone: '9877700010',
        password: await hashPassword('VendorPass123'),
        address: 'Somewhere',
        latitude: 15,
        longitude: 15,
        status: 'ACTIVE',
        approvalStatus: 'APPROVED',
        isOpen: true,
      });
      vendorId = vendor.id;

      const category = await FoodCategory.create({ name: 'Order Food Category', status: 'ACTIVE' });
      categoryId = category.id;

      const product = await FoodProduct.create({
        locationId,
        vendorId,
        categoryId,
        name: 'Test Burger',
        price: 100,
        discount: 10, // 10%
        tax: 5, // 5%
        isAvailable: true,
        status: 'ACTIVE',
      });
      productId = product.id;

      const variant = await FoodVariant.create({ productId, name: 'Large', price: 150 });
      variantId = variant.id;

      const addon = await FoodAddon.create({ vendorId, name: 'Extra Cheese', price: 20, maxQuantity: 3 });
      addonId = addon.id;
    });

    it('computes subtotal/discount/tax/deliveryFee/total server-side, ignoring nothing from the client (client sends no price fields at all)', async () => {
      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          businessType: 'FOOD',
          vendorId,
          addressId,
          paymentMethod: 'COD',
          items: [{ productId, variantId, quantity: 2, addons: [{ addonId, quantity: 1 }] }],
        });
      expect(res.status).toBe(201);

      // unitPrice=150 (variant), qty=2 -> lineSubtotal=300; addon 20*1*2=40 -> +40 = 340
      // discount = 300*0.10 = 30 (addons not discounted)
      // taxableBase = 340 - 30 = 310; tax = 310*0.05 = 15.5
      // deliveryFee: subtotal(340) < freeDeliveryAbove(500) -> 30
      const order = res.body.data;
      expect(order.subtotal).toBeCloseTo(340, 2);
      expect(order.discount).toBeCloseTo(30, 2);
      expect(order.tax).toBeCloseTo(15.5, 2);
      expect(order.deliveryFee).toBe(30);
      expect(order.total).toBeCloseTo(340 - 30 + 15.5 + 30, 2);
      expect(order.status).toBe('PENDING');
      expect(order.vendorId).toBe(vendorId);
      expect(order.storeId).toBeUndefined();
    });

    it('rejects an order for a vendor in a different location', async () => {
      const otherLocation = await Location.create({
        name: 'Other Loc',
        code: 'OTHERLOC',
        state: 'UP',
        district: 'D2',
        latitude: 50,
        longitude: 50,
      });
      const otherVendor = await Vendor.create({
        locationId: otherLocation.id,
        restaurantName: 'Other Vendor',
        ownerName: 'Owner',
        phone: '9877700011',
        password: await hashPassword('VendorPass123'),
        address: 'Elsewhere',
        latitude: 50,
        longitude: 50,
        status: 'ACTIVE',
        approvalStatus: 'APPROVED',
        isOpen: true,
      });

      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          businessType: 'FOOD',
          vendorId: otherVendor.id,
          addressId,
          paymentMethod: 'COD',
          items: [{ productId, quantity: 1, addons: [] }],
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VENDOR_LOCATION_MISMATCH');
    });

    it('rejects an order for an unavailable product', async () => {
      await FoodProduct.updateOne({ _id: productId }, { isAvailable: false });
      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ businessType: 'FOOD', vendorId, addressId, paymentMethod: 'COD', items: [{ productId, quantity: 1, addons: [] }] });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PRODUCT_NOT_AVAILABLE');
      await FoodProduct.updateOne({ _id: productId }, { isAvailable: true });
    });

    let orderId: string;
    let vendorToken: string;

    it('walks a food order through the vendor-controlled status pipeline', async () => {
      vendorToken = (
        await request(app).post('/api/v1/auth/vendor/login').send({ identifier: '9877700010', password: 'VendorPass123' })
      ).body.data.accessToken;

      const createRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ businessType: 'FOOD', vendorId, addressId, paymentMethod: 'COD', items: [{ productId, quantity: 1, addons: [] }] });
      orderId = createRes.body.data._id;

      const confirm = await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ status: 'CONFIRMED' });
      expect(confirm.status).toBe(200);
      expect(confirm.body.data.status).toBe('CONFIRMED');

      const invalidJump = await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ status: 'DELIVERED' });
      expect(invalidJump.status).toBe(400);
      expect(invalidJump.body.error.code).toBe('INVALID_STATUS_TRANSITION');

      const preparing = await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ status: 'PREPARING' });
      expect(preparing.status).toBe(200);

      const timeline = await request(app)
        .get(`/api/v1/orders/${orderId}/timeline`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(timeline.body.data.map((h: { newStatus: string }) => h.newStatus)).toEqual(['PENDING', 'CONFIRMED', 'PREPARING']);
    });

    it("forbids a different vendor from updating this order's status", async () => {
      const otherVendorPassword = await hashPassword('VendorPass123');
      await Vendor.create({
        locationId,
        restaurantName: 'Unrelated Vendor',
        ownerName: 'Owner',
        phone: '9877700012',
        password: otherVendorPassword,
        address: 'Somewhere',
        latitude: 15,
        longitude: 15,
        status: 'ACTIVE',
        approvalStatus: 'APPROVED',
        isOpen: true,
      });
      const otherVendorToken = (
        await request(app).post('/api/v1/auth/vendor/login').send({ identifier: '9877700012', password: 'VendorPass123' })
      ).body.data.accessToken;

      const res = await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${otherVendorToken}`)
        .send({ status: 'READY_FOR_PICKUP' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORDER_FORBIDDEN');
    });

    it('lets the customer cancel a PENDING order', async () => {
      const createRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ businessType: 'FOOD', vendorId, addressId, paymentMethod: 'COD', items: [{ productId, quantity: 1, addons: [] }] });
      const cancelRes = await request(app)
        .post(`/api/v1/orders/${createRes.body.data._id}/cancel`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ reason: 'Changed my mind' });
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.data.status).toBe('CANCELLED');
      expect(cancelRes.body.data.cancelledBy).toBe('CUSTOMER');
    });

    it('still allows cancellation while PREPARING (pre-pickup), but rejects it once READY_FOR_PICKUP', async () => {
      // `orderId` is currently PREPARING (advanced by the vendor-pipeline test
      // above) — per the transition map, PREPARING is still a cancellable,
      // pre-pickup state, so cancelling here should succeed...
      const cancelRes = await request(app)
        .post(`/api/v1/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ reason: 'Still in time' });
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.data.status).toBe('CANCELLED');

      // ...but once an order reaches READY_FOR_PICKUP, it's no longer cancellable.
      const createRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ businessType: 'FOOD', vendorId, addressId, paymentMethod: 'COD', items: [{ productId, quantity: 1, addons: [] }] });
      const readyOrderId = createRes.body.data._id;
      for (const status of ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP']) {
        await request(app)
          .patch(`/api/v1/orders/${readyOrderId}/status`)
          .set('Authorization', `Bearer ${vendorToken}`)
          .send({ status });
      }

      const res = await request(app)
        .post(`/api/v1/orders/${readyOrderId}/cancel`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ reason: 'Too late' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ORDER_NOT_CANCELLABLE');
    });
  });

  describe('INSTAMART orders (inventory reservation/release)', () => {
    let storeId: string;
    let productId: string;
    let inventoryId: string;

    beforeAll(async () => {
      const store = await Store.create({
        locationId,
        name: 'Order Store',
        managerName: 'Manager',
        phone: '9877700020',
        address: 'Somewhere',
        latitude: 15,
        longitude: 15,
        status: 'ACTIVE',
      });
      storeId = store.id;

      const category = await InstamartCategory.create({ name: 'Order Instamart Category', status: 'ACTIVE' });

      const product = await InstamartProduct.create({
        locationId,
        storeId,
        categoryId: category.id,
        name: 'Order Rice',
        sku: 'ORDER-RICE',
        mrp: 100,
        sellingPrice: 80,
        discount: 0,
        tax: 0,
        unit: 'kg',
        status: 'ACTIVE',
      });
      productId = product.id;

      const inventory = await Inventory.create({
        locationId,
        storeId,
        productId,
        currentStock: 10,
        reservedStock: 0,
      });
      inventoryId = inventory.id;
    });

    it('rejects an order that exceeds available stock', async () => {
      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ businessType: 'INSTAMART', storeId, addressId, paymentMethod: 'COD', items: [{ productId, quantity: 20, addons: [] }] });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    });

    let orderId: string;

    it('reserves stock atomically when the order is created', async () => {
      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ businessType: 'INSTAMART', storeId, addressId, paymentMethod: 'COD', items: [{ productId, quantity: 4, addons: [] }] });
      expect(res.status).toBe(201);
      orderId = res.body.data._id;

      const invRes = await request(app)
        .get(`/api/v1/inventory/${inventoryId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(invRes.body.data.reservedStock).toBe(4);
      expect(invRes.body.data.availableStock).toBe(6);
    });

    it('releases the reserved stock when the order is cancelled', async () => {
      const cancelRes = await request(app)
        .post(`/api/v1/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ reason: 'Out of stock elsewhere' });
      expect(cancelRes.status).toBe(200);

      const invRes = await request(app)
        .get(`/api/v1/inventory/${inventoryId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(invRes.body.data.reservedStock).toBe(0);
      expect(invRes.body.data.availableStock).toBe(10);
    });
  });

  it("rejects a customer from viewing another customer's order", async () => {
    const otherSendOtp = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9877700099' });
    const otherVerify = await request(app)
      .post('/api/v1/auth/customer/verify-otp')
      .send({ phone: '9877700099', otp: otherSendOtp.body.data.devOtp });
    const otherToken = otherVerify.body.data.accessToken;

    const listRes = await request(app).get('/api/v1/orders').set('Authorization', `Bearer ${customerToken}`);
    const anyOrderId = listRes.body.data[0]._id;

    const res = await request(app).get(`/api/v1/orders/${anyOrderId}`).set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ORDER_FORBIDDEN');
  });
});
