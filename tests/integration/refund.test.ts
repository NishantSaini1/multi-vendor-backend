import crypto from 'crypto';
import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { razorpay } from '../../src/config/razorpay';
import { AdminUser } from '../../src/models/AdminUser';
import { Location } from '../../src/models/Location';
import { DeliveryZone } from '../../src/models/DeliveryZone';
import { Vendor } from '../../src/models/Vendor';
import { FoodCategory } from '../../src/models/FoodCategory';
import { FoodProduct } from '../../src/models/FoodProduct';
import { Payment } from '../../src/models/Payment';
import { Order } from '../../src/models/Order';
import { Wallet } from '../../src/models/Wallet';
import { hashPassword } from '../../src/utils/password';
import { startTestDatabase, stopTestDatabase } from './testServer';

function checkoutSignature(razorpayOrderId: string, razorpayPaymentId: string) {
  return crypto.createHmac('sha256', process.env.RAZORPAY_SECRET!).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest('hex');
}

describe('Refunds: admin-initiated (Razorpay gateway + wallet credit) and auto-refund on cancellation', () => {
  let locationId: string;
  let financeAdminToken: string;
  let customerToken: string;
  let customerId: string;
  let addressId: string;
  let vendorId: string;
  let productId: string;

  async function placeOrder(paymentMethod: string) {
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ businessType: 'FOOD', vendorId, addressId, paymentMethod, items: [{ productId, quantity: 1, addons: [] }] });
    return res.body.data;
  }

  async function payWithWallet() {
    await request(app)
      .post(`/api/v1/customers/${customerId}/wallet/adjust`)
      .set('Authorization', `Bearer ${financeAdminToken}`)
      .send({ amount: 1000, type: 'CREDIT', note: 'Top-up for refund test' });
    return placeOrder('WALLET');
  }

  async function payWithRazorpay(razorpayOrderId: string, razorpayPaymentId: string) {
    const order = await placeOrder('RAZORPAY');
    (jest.spyOn(razorpay.orders, 'create') as unknown as jest.Mock).mockResolvedValueOnce({ id: razorpayOrderId, amount: 12000, currency: 'INR' });
    await request(app)
      .post('/api/v1/payments/razorpay-order')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ orderId: order._id });
    await request(app)
      .post('/api/v1/payments/verify')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        orderId: order._id,
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: checkoutSignature(razorpayOrderId, razorpayPaymentId),
      });
    return order;
  }

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();

    const location = await Location.create({
      name: 'Refund City',
      code: 'REFUNDCITY',
      state: 'UP',
      district: 'D1',
      latitude: 14,
      longitude: 14,
      serviceRadius: 20,
    });
    locationId = location.id;

    await DeliveryZone.create({
      locationId,
      name: 'Refund Zone',
      centerLatitude: 14,
      centerLongitude: 14,
      radius: 10,
      deliveryFee: 25,
      freeDeliveryAbove: 1000,
      estimatedDeliveryTime: 30,
      status: 'ACTIVE',
    });

    const financePassword = await hashPassword('Password123');
    await AdminUser.create({
      name: 'Finance',
      email: 'r.finance@example.com',
      password: financePassword,
      role: 'FINANCE_ADMIN',
      locationIds: [],
    });
    financeAdminToken = (
      await request(app).post('/api/v1/auth/admin/login').send({ email: 'r.finance@example.com', password: 'Password123' })
    ).body.data.accessToken;

    const sendOtp = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9877600001' });
    const verify = await request(app)
      .post('/api/v1/auth/customer/verify-otp')
      .send({ phone: '9877600001', otp: sendOtp.body.data.devOtp });
    customerToken = verify.body.data.accessToken;
    customerId = verify.body.data.customer._id;

    const addressRes = await request(app)
      .post(`/api/v1/customers/${customerId}/addresses`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ locationId, address: '1 Refund Lane', pincode: '110066', latitude: 14, longitude: 14 });
    addressId = addressRes.body.data._id;

    const vendor = await Vendor.create({
      locationId,
      restaurantName: 'Refund Restaurant',
      ownerName: 'Owner',
      phone: '9877600010',
      password: await hashPassword('VendorPass123'),
      address: 'Somewhere',
      latitude: 14,
      longitude: 14,
      status: 'ACTIVE',
      approvalStatus: 'APPROVED',
      isOpen: true,
    });
    vendorId = vendor.id;

    const category = await FoodCategory.create({ name: 'Refund Food Category', status: 'ACTIVE' });
    const product = await FoodProduct.create({
      locationId,
      vendorId,
      categoryId: category.id,
      name: 'Refund Thali',
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

  it('refunds a WALLET-paid order back to the wallet, marking Payment/Order REFUNDED', async () => {
    const order = await payWithWallet();
    const walletBefore = await Wallet.findOne({ customerId });
    expect(walletBefore?.balance).toBe(1000 - 125);

    const res = await request(app)
      .post('/api/v1/refunds')
      .set('Authorization', `Bearer ${financeAdminToken}`)
      .send({ orderId: order._id, type: 'FULL', reason: 'Customer requested a refund' });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('COMPLETED');
    expect(res.body.data.amount).toBe(125);

    const walletAfter = await Wallet.findOne({ customerId });
    expect(walletAfter?.balance).toBe(1000);

    const payment = await Payment.findById(order.paymentId);
    expect(payment?.status).toBe('REFUNDED');
    const updatedOrder = await Order.findById(order._id);
    expect(updatedOrder?.paymentStatus).toBe('REFUNDED');
  });

  it('rejects refunding an order that has no paid payment', async () => {
    const order = await placeOrder('COD');
    const res = await request(app)
      .post('/api/v1/refunds')
      .set('Authorization', `Bearer ${financeAdminToken}`)
      .send({ orderId: order._id, type: 'FULL', reason: 'No payment collected yet' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PAYMENT_NOT_FOUND');
  });

  it('requires an amount for a PARTIAL refund and rejects amounts over the refundable balance', async () => {
    const order = await payWithWallet();

    const missingAmount = await request(app)
      .post('/api/v1/refunds')
      .set('Authorization', `Bearer ${financeAdminToken}`)
      .send({ orderId: order._id, type: 'PARTIAL', reason: 'Partial goodwill' });
    // Caught by the validator's zod .refine(), not the service — this
    // codebase's errorHandler maps ZodError to 422, not 400.
    expect(missingAmount.status).toBe(422);

    const tooMuch = await request(app)
      .post('/api/v1/refunds')
      .set('Authorization', `Bearer ${financeAdminToken}`)
      .send({ orderId: order._id, type: 'PARTIAL', amount: 9999, reason: 'Partial goodwill' });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.code).toBe('REFUND_AMOUNT_EXCEEDS_BALANCE');

    const ok = await request(app)
      .post('/api/v1/refunds')
      .set('Authorization', `Bearer ${financeAdminToken}`)
      .send({ orderId: order._id, type: 'PARTIAL', amount: 50, reason: 'Partial goodwill' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.amount).toBe(50);

    const payment = await Payment.findById(order.paymentId);
    expect(payment?.status).toBe('PARTIALLY_REFUNDED');
  });

  it('refunds a RAZORPAY-paid order through the gateway (mocked), not the wallet', async () => {
    const walletBefore = await Wallet.findOne({ customerId });
    const order = await payWithRazorpay('order_refund_rzp1', 'pay_refund_rzp1');
    (jest.spyOn(razorpay.payments, 'refund') as unknown as jest.Mock).mockResolvedValueOnce({ id: 'rfnd_fixture1' });

    const res = await request(app)
      .post('/api/v1/refunds')
      .set('Authorization', `Bearer ${financeAdminToken}`)
      .send({ orderId: order._id, type: 'FULL', reason: 'Gateway refund test' });
    expect(res.status).toBe(201);
    expect(res.body.data.razorpayRefundId).toBe('rfnd_fixture1');
    expect(razorpay.payments.refund).toHaveBeenCalledWith('pay_refund_rzp1', expect.objectContaining({ amount: 12500 }));

    const walletAfter = await Wallet.findOne({ customerId });
    // Gateway refunds must not touch the wallet — RAZORPAY order creation
    // never debited it either, so the balance should be exactly unchanged.
    expect(walletAfter?.balance).toBe(walletBefore?.balance);
  });

  it('auto-refunds a WALLET-paid order to the wallet when it is cancelled', async () => {
    const order = await payWithWallet();
    const walletBefore = await Wallet.findOne({ customerId });

    const cancelRes = await request(app)
      .post(`/api/v1/orders/${order._id}/cancel`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ reason: 'Changed my mind' });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.status).toBe('CANCELLED');

    const walletAfter = await Wallet.findOne({ customerId });
    expect(walletAfter?.balance).toBe((walletBefore?.balance ?? 0) + 125);

    const updatedOrder = await Order.findById(order._id);
    expect(updatedOrder?.paymentStatus).toBe('REFUNDED');

    const refund = await request(app)
      .get('/api/v1/refunds')
      .set('Authorization', `Bearer ${financeAdminToken}`)
      .query({ orderId: order._id });
    expect(refund.body.data).toHaveLength(1);
    expect(refund.body.data[0].reason).toContain('Order cancelled');
  });

  it('does not touch payment status when cancelling an unpaid COD order', async () => {
    const order = await placeOrder('COD');
    const cancelRes = await request(app)
      .post(`/api/v1/orders/${order._id}/cancel`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ reason: 'Never mind' });
    expect(cancelRes.status).toBe(200);

    const updatedOrder = await Order.findById(order._id);
    expect(updatedOrder?.paymentStatus).toBe('PENDING');
  });

  it("rejects a customer from creating a refund (admin-only)", async () => {
    const order = await payWithWallet();
    const res = await request(app)
      .post('/api/v1/refunds')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ orderId: order._id, type: 'FULL', reason: 'Should not work' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('USER_TYPE_FORBIDDEN');
  });
});
