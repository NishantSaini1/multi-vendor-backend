import crypto from 'crypto';
import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { razorpay } from '../../src/config/razorpay';
import { Location } from '../../src/models/Location';
import { DeliveryZone } from '../../src/models/DeliveryZone';
import { Vendor } from '../../src/models/Vendor';
import { FoodCategory } from '../../src/models/FoodCategory';
import { FoodProduct } from '../../src/models/FoodProduct';
import { Payment } from '../../src/models/Payment';
import { Order } from '../../src/models/Order';
import { hashPassword } from '../../src/utils/password';
import { startTestDatabase, stopTestDatabase } from './testServer';

function checkoutSignature(razorpayOrderId: string, razorpayPaymentId: string) {
  return crypto.createHmac('sha256', process.env.RAZORPAY_SECRET!).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest('hex');
}

function webhookBody(event: string, razorpayOrderId: string, razorpayPaymentId: string) {
  return JSON.stringify({
    event,
    payload: { payment: { entity: { id: razorpayPaymentId, order_id: razorpayOrderId, error_description: 'Card declined' } } },
  });
}

function webhookSignature(rawBody: string) {
  return crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET!).update(rawBody).digest('hex');
}

describe('Payments: Razorpay checkout, signature verification, webhook', () => {
  let locationId: string;
  let customerToken: string;
  let addressId: string;
  let vendorId: string;
  let productId: string;

  async function createRazorpayOrder() {
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ businessType: 'FOOD', vendorId, addressId, paymentMethod: 'RAZORPAY', items: [{ productId, quantity: 1, addons: [] }] });
    return res.body.data;
  }

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();

    const location = await Location.create({
      name: 'Payment City',
      code: 'PAYCITY',
      state: 'UP',
      district: 'D1',
      latitude: 13,
      longitude: 13,
      serviceRadius: 20,
    });
    locationId = location.id;

    await DeliveryZone.create({
      locationId,
      name: 'Payment Zone',
      centerLatitude: 13,
      centerLongitude: 13,
      radius: 10,
      deliveryFee: 20,
      freeDeliveryAbove: 1000,
      estimatedDeliveryTime: 30,
      status: 'ACTIVE',
    });

    const sendOtp = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9877900001' });
    const verify = await request(app)
      .post('/api/v1/auth/customer/verify-otp')
      .send({ phone: '9877900001', otp: sendOtp.body.data.devOtp });
    customerToken = verify.body.data.accessToken;
    const customerId = verify.body.data.customer._id;

    const addressRes = await request(app)
      .post(`/api/v1/customers/${customerId}/addresses`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ locationId, address: '1 Payment Lane', pincode: '110077', latitude: 13, longitude: 13 });
    addressId = addressRes.body.data._id;

    const vendor = await Vendor.create({
      locationId,
      restaurantName: 'Payment Restaurant',
      ownerName: 'Owner',
      phone: '9877900010',
      password: await hashPassword('VendorPass123'),
      address: 'Somewhere',
      latitude: 13,
      longitude: 13,
      status: 'ACTIVE',
      approvalStatus: 'APPROVED',
      isOpen: true,
    });
    vendorId = vendor.id;

    const category = await FoodCategory.create({ name: 'Payment Food Category', status: 'ACTIVE' });
    const product = await FoodProduct.create({
      locationId,
      vendorId,
      categoryId: category.id,
      name: 'Payment Thali',
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

  it('creates a Razorpay order for a RAZORPAY-method order without touching the real gateway', async () => {
    const order = await createRazorpayOrder();
    expect(order.paymentStatus).toBe('PENDING');

    (jest.spyOn(razorpay.orders, 'create') as unknown as jest.Mock).mockResolvedValueOnce({ id: 'order_fixture1', amount: 12000, currency: 'INR' });

    const res = await request(app)
      .post('/api/v1/payments/razorpay-order')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ orderId: order._id });
    expect(res.status).toBe(201);
    expect(res.body.data.razorpayOrderId).toBe('order_fixture1');
    expect(razorpay.orders.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 12000, currency: 'INR' }));
  });

  it('rejects checkout verification with an invalid signature and marks the payment FAILED', async () => {
    const order = await createRazorpayOrder();
    (jest.spyOn(razorpay.orders, 'create') as unknown as jest.Mock).mockResolvedValueOnce({ id: 'order_fixture2', amount: 12000, currency: 'INR' });
    await request(app)
      .post('/api/v1/payments/razorpay-order')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ orderId: order._id });

    const res = await request(app)
      .post('/api/v1/payments/verify')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ orderId: order._id, razorpayOrderId: 'order_fixture2', razorpayPaymentId: 'pay_fixture2', razorpaySignature: 'not-a-real-signature' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PAYMENT_SIGNATURE_INVALID');

    const payment = await Payment.findOne({ razorpayOrderId: 'order_fixture2' });
    expect(payment?.status).toBe('FAILED');
  });

  it('accepts a correctly signed checkout verification and marks the order PAID', async () => {
    const order = await createRazorpayOrder();
    (jest.spyOn(razorpay.orders, 'create') as unknown as jest.Mock).mockResolvedValueOnce({ id: 'order_fixture3', amount: 12000, currency: 'INR' });
    await request(app)
      .post('/api/v1/payments/razorpay-order')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ orderId: order._id });

    const signature = checkoutSignature('order_fixture3', 'pay_fixture3');
    const res = await request(app)
      .post('/api/v1/payments/verify')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ orderId: order._id, razorpayOrderId: 'order_fixture3', razorpayPaymentId: 'pay_fixture3', razorpaySignature: signature });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('PAID');

    const updatedOrder = await Order.findById(order._id);
    expect(updatedOrder?.paymentStatus).toBe('PAID');
  });

  it('rejects a webhook call with a bad signature', async () => {
    const body = webhookBody('payment.captured', 'order_fixture_wh_bad', 'pay_wh_bad');
    const res = await request(app)
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', 'wrong-signature')
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
  });

  it('marks the payment PAID from a correctly signed payment.captured webhook, independent of /verify', async () => {
    const order = await createRazorpayOrder();
    (jest.spyOn(razorpay.orders, 'create') as unknown as jest.Mock).mockResolvedValueOnce({ id: 'order_fixture_wh', amount: 12000, currency: 'INR' });
    await request(app)
      .post('/api/v1/payments/razorpay-order')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ orderId: order._id });

    const body = webhookBody('payment.captured', 'order_fixture_wh', 'pay_wh_1');
    const res = await request(app)
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', webhookSignature(body))
      .send(body);
    expect(res.status).toBe(200);

    const payment = await Payment.findOne({ razorpayOrderId: 'order_fixture_wh' });
    expect(payment?.status).toBe('PAID');
    expect(payment?.razorpayPaymentId).toBe('pay_wh_1');

    const updatedOrder = await Order.findById(order._id);
    expect(updatedOrder?.paymentStatus).toBe('PAID');
  });

  it('marks the payment FAILED from a payment.failed webhook', async () => {
    const order = await createRazorpayOrder();
    (jest.spyOn(razorpay.orders, 'create') as unknown as jest.Mock).mockResolvedValueOnce({ id: 'order_fixture_wh_fail', amount: 12000, currency: 'INR' });
    await request(app)
      .post('/api/v1/payments/razorpay-order')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ orderId: order._id });

    const body = webhookBody('payment.failed', 'order_fixture_wh_fail', 'pay_wh_fail');
    const res = await request(app)
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', webhookSignature(body))
      .send(body);
    expect(res.status).toBe(200);

    const payment = await Payment.findOne({ razorpayOrderId: 'order_fixture_wh_fail' });
    expect(payment?.status).toBe('FAILED');

    const updatedOrder = await Order.findById(order._id);
    expect(updatedOrder?.paymentStatus).toBe('PENDING');
  });

  it("rejects a customer from viewing another customer's payment", async () => {
    const order = await createRazorpayOrder();
    (jest.spyOn(razorpay.orders, 'create') as unknown as jest.Mock).mockResolvedValueOnce({ id: 'order_fixture_owner', amount: 12000, currency: 'INR' });
    const createRes = await request(app)
      .post('/api/v1/payments/razorpay-order')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ orderId: order._id });

    const otherSendOtp = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9877900099' });
    const otherVerify = await request(app)
      .post('/api/v1/auth/customer/verify-otp')
      .send({ phone: '9877900099', otp: otherSendOtp.body.data.devOtp });
    const otherToken = otherVerify.body.data.accessToken;

    const res = await request(app)
      .get(`/api/v1/payments/${createRes.body.data.paymentId}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ORDER_FORBIDDEN');
  });
});
