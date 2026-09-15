import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { AdminUser } from '../../src/models/AdminUser';
import { Location } from '../../src/models/Location';
import { DeliveryZone } from '../../src/models/DeliveryZone';
import { FoodCategory } from '../../src/models/FoodCategory';
import { FoodVariant } from '../../src/models/FoodVariant';
import { VendorFoodItem } from '../../src/models/VendorFoodItem';
import { ModifierGroup } from '../../src/models/ModifierGroup';
import { ModifierOption } from '../../src/models/ModifierOption';
import { InstamartCategory } from '../../src/models/InstamartCategory';
import { Inventory } from '../../src/models/Inventory';
import { hashPassword } from '../../src/utils/password';
import { startTestDatabase, stopTestDatabase } from './testServer';
import { createTestVendor, createOrderableFoodItem, createTestStore, createInstamartListing } from './helpers/foodFixtures';

describe('Orders: pricing, inventory reservation, status machine, cancellation', () => {
  let locationId: string;
  let deliveryZoneId: string;
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

    const zone = await DeliveryZone.create({
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
    deliveryZoneId = zone.id;

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
    let modifierOptionId: string;

    beforeAll(async () => {
      const vendor = await createTestVendor({
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

      // GLOBAL FoodProduct (name/category) + this vendor's own priced
      // listing (VendorFoodItem) — price/availability live on the listing,
      // not the global item, since Stage 2. `productId` in an order's
      // items[] is the VendorFoodItem id, same role the old flat
      // FoodProduct id used to play.
      const vendorFoodItem = await createOrderableFoodItem(vendorId, categoryId, { name: 'Test Burger', price: 100 });
      productId = vendorFoodItem.id;

      const variant = await FoodVariant.create({ vendorFoodItemId: productId, name: 'Large', price: 150 });
      variantId = variant.id;

      // ModifierGroup/ModifierOption replaced the old flat FoodAddon model.
      const modifierGroup = await ModifierGroup.create({
        vendorFoodItemId: productId,
        name: 'Extras',
        minSelection: 0,
        maxSelection: 3,
        required: false,
        status: 'ACTIVE',
      });
      const modifierOption = await ModifierOption.create({
        modifierGroupId: modifierGroup.id,
        name: 'Extra Cheese',
        price: 20,
        status: 'ACTIVE',
      });
      modifierOptionId = modifierOption.id;
    });

    it('computes subtotal/deliveryFee/total server-side, ignoring nothing from the client (client sends no price fields at all), and leaves the commission snapshot unset when no Commission rule applies', async () => {
      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          businessType: 'FOOD',
          vendorId,
          addressId,
          paymentMethod: 'COD',
          items: [{ productId, variantId, quantity: 2, modifiers: [{ modifierOptionId, quantity: 1 }] }],
        });
      expect(res.status).toBe(201);

      // unitPrice=150 (variant), qty=2 -> lineSubtotal=300; modifier 20*1*2=40 -> +40 = 340
      // Food lines carry no item-level discount/tax since Stage 2 (only the
      // global FoodProduct/VendorFoodItem split — neither has those fields
      // anymore); only a Coupon could discount at the order level, and none
      // is applied here.
      // deliveryFee: subtotal(340) < freeDeliveryAbove(500) -> 30
      const order = res.body.data;
      expect(order.subtotal).toBeCloseTo(340, 2);
      expect(order.discount).toBe(0);
      expect(order.tax).toBe(0);
      expect(order.deliveryFee).toBe(30);
      expect(order.total).toBeCloseTo(340 + 30, 2);
      expect(order.status).toBe('PENDING');
      expect(order.vendorId).toBe(vendorId);
      expect(order.storeId).toBeUndefined();

      // Commission snapshot (Stage 4): no Commission rule is configured for
      // this vendor/location, so resolveCommission returns null and all four
      // fields stay unset — see the richer "commission IS applied" coverage
      // in settlement.test.ts, where a GLOBAL rule is actually configured.
      expect(order.commissionType).toBeUndefined();
      expect(order.commissionAmount).toBeUndefined();
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
      const otherVendor = await createTestVendor({
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
          items: [{ productId, quantity: 1, modifiers: [] }],
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VENDOR_LOCATION_MISMATCH');
    });

    it('rejects an order for an unavailable product', async () => {
      await VendorFoodItem.updateOne({ _id: productId }, { availabilityStatus: 'OUT_OF_STOCK' });
      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ businessType: 'FOOD', vendorId, addressId, paymentMethod: 'COD', items: [{ productId, quantity: 1, modifiers: [] }] });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PRODUCT_NOT_AVAILABLE');
      await VendorFoodItem.updateOne({ _id: productId }, { availabilityStatus: 'AVAILABLE' });
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
        .send({ businessType: 'FOOD', vendorId, addressId, paymentMethod: 'COD', items: [{ productId, quantity: 1, modifiers: [] }] });
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
      await createTestVendor({
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
        .send({ businessType: 'FOOD', vendorId, addressId, paymentMethod: 'COD', items: [{ productId, quantity: 1, modifiers: [] }] });
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
        .send({ businessType: 'FOOD', vendorId, addressId, paymentMethod: 'COD', items: [{ productId, quantity: 1, modifiers: [] }] });
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
      // checkServiceability's INSTAMART presence check
      // (serviceability.service.ts's hasActiveBusinessPresence) matches on
      // deliveryZoneId against the zone actually resolved for the
      // customer's address coordinates — it must be the REAL "Order Zone"
      // above, not an unrelated placeholder zone createTestStore would
      // otherwise auto-create.
      const store = await createTestStore({
        locationId,
        deliveryZoneId,
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

      const product = await createInstamartListing(locationId, storeId, category.id, {
        name: 'Order Rice',
        sku: 'ORDER-RICE',
        mrp: 100,
        sellingPrice: 80,
        unit: 'kg',
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
        .send({ businessType: 'INSTAMART', storeId, addressId, paymentMethod: 'COD', items: [{ productId, quantity: 20, modifiers: [] }] });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    });

    let orderId: string;

    it('reserves stock atomically when the order is created', async () => {
      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ businessType: 'INSTAMART', storeId, addressId, paymentMethod: 'COD', items: [{ productId, quantity: 4, modifiers: [] }] });
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
