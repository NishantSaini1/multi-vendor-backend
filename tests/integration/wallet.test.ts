import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { AdminUser } from '../../src/models/AdminUser';
import { Location } from '../../src/models/Location';
import { DeliveryZone } from '../../src/models/DeliveryZone';
import { Vendor } from '../../src/models/Vendor';
import { FoodCategory } from '../../src/models/FoodCategory';
import { FoodProduct } from '../../src/models/FoodProduct';
import { Wallet } from '../../src/models/Wallet';
import { hashPassword } from '../../src/utils/password';
import { startTestDatabase, stopTestDatabase } from './testServer';

describe('Wallet: balance, transactions, admin adjustment, WALLET as a payment method', () => {
  let locationId: string;
  let financeAdminToken: string;
  let customerToken: string;
  let customerId: string;
  let addressId: string;
  let vendorId: string;
  let productId: string;

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();

    const location = await Location.create({
      name: 'Wallet City',
      code: 'WALLETCITY',
      state: 'UP',
      district: 'D1',
      latitude: 12,
      longitude: 12,
      serviceRadius: 20,
    });
    locationId = location.id;

    await DeliveryZone.create({
      locationId,
      name: 'Wallet Zone',
      centerLatitude: 12,
      centerLongitude: 12,
      radius: 10,
      deliveryFee: 25,
      freeDeliveryAbove: 1000,
      estimatedDeliveryTime: 30,
      status: 'ACTIVE',
    });

    const financePassword = await hashPassword('Password123');
    await AdminUser.create({
      name: 'Finance',
      email: 'w.finance@example.com',
      password: financePassword,
      role: 'FINANCE_ADMIN',
      locationIds: [],
    });
    financeAdminToken = (
      await request(app).post('/api/v1/auth/admin/login').send({ email: 'w.finance@example.com', password: 'Password123' })
    ).body.data.accessToken;

    const sendOtp = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9877800001' });
    const verify = await request(app)
      .post('/api/v1/auth/customer/verify-otp')
      .send({ phone: '9877800001', otp: sendOtp.body.data.devOtp });
    customerToken = verify.body.data.accessToken;
    customerId = verify.body.data.customer._id;

    const addressRes = await request(app)
      .post(`/api/v1/customers/${customerId}/addresses`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ locationId, address: '1 Wallet Lane', pincode: '110088', latitude: 12, longitude: 12 });
    addressId = addressRes.body.data._id;

    const vendor = await Vendor.create({
      locationId,
      restaurantName: 'Wallet Restaurant',
      ownerName: 'Owner',
      phone: '9877800010',
      password: await hashPassword('VendorPass123'),
      address: 'Somewhere',
      latitude: 12,
      longitude: 12,
      status: 'ACTIVE',
      approvalStatus: 'APPROVED',
      isOpen: true,
    });
    vendorId = vendor.id;

    const category = await FoodCategory.create({ name: 'Wallet Food Category', status: 'ACTIVE' });
    const product = await FoodProduct.create({
      locationId,
      vendorId,
      categoryId: category.id,
      name: 'Wallet Thali',
      price: 100,
      discount: 0,
      tax: 0,
      isAvailable: true,
      status: 'ACTIVE',
    });
    productId = product.id;
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  it("returns a zero-balance wallet for a customer who has never had one created", async () => {
    const res = await request(app)
      .get(`/api/v1/customers/${customerId}/wallet`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.balance).toBe(0);
  });

  it("rejects placing a WALLET order when the balance is insufficient", async () => {
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ businessType: 'FOOD', vendorId, addressId, paymentMethod: 'WALLET', items: [{ productId, quantity: 1, addons: [] }] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_WALLET_BALANCE');
  });

  it('lets a FINANCE_ADMIN credit a customer wallet, recording a WalletTransaction', async () => {
    const res = await request(app)
      .post(`/api/v1/customers/${customerId}/wallet/adjust`)
      .set('Authorization', `Bearer ${financeAdminToken}`)
      .send({ amount: 500, type: 'CREDIT', note: 'Goodwill credit' });
    expect(res.status).toBe(200);
    expect(res.body.data.balance).toBe(500);

    const txRes = await request(app)
      .get(`/api/v1/customers/${customerId}/wallet/transactions`)
      .set('Authorization', `Bearer ${financeAdminToken}`);
    expect(txRes.status).toBe(200);
    expect(txRes.body.data).toHaveLength(1);
    expect(txRes.body.data[0]).toMatchObject({ type: 'CREDIT', amount: 500, balanceBefore: 0, balanceAfter: 500 });
  });

  it('rejects a customer token from hitting the admin-only /adjust endpoint', async () => {
    const res = await request(app)
      .post(`/api/v1/customers/${customerId}/wallet/adjust`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ amount: 100, type: 'CREDIT', note: 'Should not work' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('USER_TYPE_FORBIDDEN');
  });

  it("rejects a customer from viewing another customer's wallet", async () => {
    const otherSendOtp = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9877800099' });
    const otherVerify = await request(app)
      .post('/api/v1/auth/customer/verify-otp')
      .send({ phone: '9877800099', otp: otherSendOtp.body.data.devOtp });
    const otherToken = otherVerify.body.data.accessToken;

    const res = await request(app)
      .get(`/api/v1/customers/${customerId}/wallet`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('WALLET_FORBIDDEN');
  });

  it('debits the wallet synchronously and marks the order PAID when paying with WALLET', async () => {
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ businessType: 'FOOD', vendorId, addressId, paymentMethod: 'WALLET', items: [{ productId, quantity: 1, addons: [] }] });
    expect(res.status).toBe(201);
    expect(res.body.data.paymentStatus).toBe('PAID');
    expect(res.body.data.paymentId).toBeTruthy();

    const walletRes = await request(app)
      .get(`/api/v1/customers/${customerId}/wallet`)
      .set('Authorization', `Bearer ${financeAdminToken}`);
    // 500 credited above, minus the order total (subtotal 100 + deliveryFee 25, no discount/tax)
    expect(walletRes.body.data.balance).toBe(500 - 125);

    const wallet = await Wallet.findOne({ customerId });
    expect(wallet?.balance).toBe(375);
  });
});
