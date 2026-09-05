import { Payment, IPayment } from '../models/Payment';
import { Order } from '../models/Order';
import { razorpay } from '../config/razorpay';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { assertLocationAccess, locationScopeFilter } from '../middleware/rbac.middleware';
import { verifyCheckoutSignature, verifyWebhookSignature } from '../utils/razorpaySignature';
import { PAYMENT_METHODS, PAYMENT_STATUS } from '../constants/paymentStatus';
import { NOTIFICATION_TYPES } from '../constants/enums';
import * as notificationService from './notification.service';
import { logger } from '../utils/logger';

async function findOrderOrThrow(orderId: string) {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound('Order not found', 'ORDER_NOT_FOUND');
  return order;
}

function assertOwnsOrder(user: JwtPayload, customerId: string): void {
  if (user.userId !== customerId) {
    throw ApiError.forbidden('You do not have access to this order', 'ORDER_FORBIDDEN');
  }
}

export async function createRazorpayOrder(orderId: string, user: JwtPayload) {
  const order = await findOrderOrThrow(orderId);
  assertOwnsOrder(user, order.customerId.toString());

  if (order.paymentMethod !== PAYMENT_METHODS.RAZORPAY) {
    throw ApiError.badRequest('This order is not set up for online payment', 'PAYMENT_METHOD_MISMATCH');
  }
  if (order.paymentStatus === PAYMENT_STATUS.PAID) {
    throw ApiError.conflict('This order has already been paid', 'ORDER_ALREADY_PAID');
  }
  if (order.status === 'CANCELLED') {
    throw ApiError.badRequest('This order has been cancelled', 'ORDER_CANCELLED');
  }

  let payment = await Payment.findOne({ orderId: order.id, status: PAYMENT_STATUS.PENDING });

  const razorpayOrder = await razorpay.orders.create({
    amount: Math.round(order.total * 100),
    currency: 'INR',
    receipt: order.orderNumber,
    notes: { orderId: order.id },
  });

  if (!payment) {
    payment = await Payment.create({
      orderId: order.id,
      customerId: order.customerId,
      amount: order.total,
      method: PAYMENT_METHODS.RAZORPAY,
      status: PAYMENT_STATUS.PENDING,
      razorpayOrderId: razorpayOrder.id,
    });
    order.paymentId = payment.id;
    await order.save();
  } else {
    payment.razorpayOrderId = razorpayOrder.id;
    await payment.save();
  }

  return {
    paymentId: payment.id,
    razorpayOrderId: razorpayOrder.id,
    amount: razorpayOrder.amount,
    currency: razorpayOrder.currency,
    keyId: env.RAZORPAY_KEY_ID,
  };
}

export async function verifyPayment(
  data: { orderId: string; razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string },
  user: JwtPayload,
) {
  const order = await findOrderOrThrow(data.orderId);
  assertOwnsOrder(user, order.customerId.toString());

  const payment = await Payment.findOne({ orderId: order.id, razorpayOrderId: data.razorpayOrderId });
  if (!payment) throw ApiError.notFound('Payment record not found for this order', 'PAYMENT_NOT_FOUND');

  const valid = verifyCheckoutSignature(data.razorpayOrderId, data.razorpayPaymentId, data.razorpaySignature);
  if (!valid) {
    payment.status = PAYMENT_STATUS.FAILED;
    payment.failureReason = 'Signature verification failed';
    await payment.save();
    throw ApiError.badRequest('Payment verification failed', 'PAYMENT_SIGNATURE_INVALID');
  }

  await markPaymentPaid(payment, data.razorpayPaymentId, data.razorpaySignature);
  return payment;
}

async function markPaymentPaid(payment: InstanceType<typeof Payment>, razorpayPaymentId: string, razorpaySignature?: string) {
  if (payment.status === PAYMENT_STATUS.PAID) return;

  payment.status = PAYMENT_STATUS.PAID;
  payment.razorpayPaymentId = razorpayPaymentId;
  if (razorpaySignature) payment.razorpaySignature = razorpaySignature;
  payment.paidAt = new Date();
  await payment.save();

  const order = await Order.findOneAndUpdate(
    { _id: payment.orderId },
    { paymentStatus: PAYMENT_STATUS.PAID, paymentId: payment.id },
    { new: true },
  );

  if (order) {
    await notificationService.notify(
      order.customerId.toString(),
      'CUSTOMER',
      NOTIFICATION_TYPES.PAYMENT_SUCCESS,
      'Payment successful',
      `Your payment of ${payment.amount} for order ${order.orderNumber} was successful.`,
      { orderId: order.id, paymentId: payment.id },
    );
  }
}

async function markPaymentFailed(payment: InstanceType<typeof Payment>, reason: string) {
  if (payment.status === PAYMENT_STATUS.PAID) return;
  payment.status = PAYMENT_STATUS.FAILED;
  payment.failureReason = reason;
  await payment.save();
}

// Webhook events are the authoritative fallback for payment confirmation —
// the client-side /verify call can be lost to a network drop after Razorpay
// has already captured the payment, so this path must be able to mark a
// payment PAID on its own, not just double-check /verify's work. Every branch
// is idempotent (re-delivered events are a normal part of Razorpay's retry
// behavior) and always resolves 200 once the signature checks out, so
// Razorpay doesn't keep retrying a webhook we've already understood.
export async function handleWebhook(rawBody: Buffer, signature: string | undefined) {
  if (!signature || !verifyWebhookSignature(rawBody, signature)) {
    throw ApiError.badRequest('Invalid webhook signature', 'WEBHOOK_SIGNATURE_INVALID');
  }

  const event = JSON.parse(rawBody.toString('utf8')) as {
    event: string;
    payload: { payment?: { entity: Record<string, unknown> }; refund?: { entity: Record<string, unknown> } };
  };

  switch (event.event) {
    case 'payment.captured': {
      const entity = event.payload.payment?.entity;
      if (!entity) break;
      const payment = await Payment.findOne({ razorpayOrderId: entity.order_id as string });
      if (!payment) {
        logger.warn({ razorpayOrderId: entity.order_id }, 'Webhook payment.captured for unknown Payment record');
        break;
      }
      await markPaymentPaid(payment, entity.id as string);
      break;
    }
    case 'payment.failed': {
      const entity = event.payload.payment?.entity;
      if (!entity) break;
      const payment = await Payment.findOne({ razorpayOrderId: entity.order_id as string });
      if (payment) await markPaymentFailed(payment, (entity.error_description as string) ?? 'Payment failed');
      break;
    }
    default:
      logger.info({ event: event.event }, 'Unhandled Razorpay webhook event');
  }

  return { received: true };
}

function assertPaymentAccess(user: JwtPayload, payment: IPayment, orderLocationId?: string): void {
  if (user.userType === 'CUSTOMER') {
    assertOwnsOrder(user, payment.customerId.toString());
    return;
  }
  assertLocationAccess(user, orderLocationId);
}

export async function getPaymentById(id: string, user: JwtPayload) {
  const payment = await Payment.findById(id);
  if (!payment) throw ApiError.notFound('Payment not found', 'PAYMENT_NOT_FOUND');
  const order = await Order.findById(payment.orderId);
  assertPaymentAccess(user, payment, order?.locationId.toString());
  return payment;
}

export function paymentListFilter(user: JwtPayload): Record<string, unknown> {
  if (user.userType === 'CUSTOMER') return { customerId: user.userId };
  return {};
}

export async function listPayments(filter: Record<string, unknown>, user: JwtPayload, pagination: PaginationParams) {
  // Admins other than SUPER_ADMIN are still location-scoped, but Payment has
  // no locationId of its own — restrict via the owning Order's location.
  let orderFilter: Record<string, unknown> = {};
  if (user.userType === 'ADMIN') {
    orderFilter = locationScopeFilter(user);
  }

  let effectiveFilter = filter;
  if (Object.keys(orderFilter).length > 0) {
    const orderIds = await Order.find(orderFilter).distinct('_id');
    effectiveFilter = { ...filter, orderId: { $in: orderIds } };
  }

  const [items, total] = await Promise.all([
    Payment.find(effectiveFilter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    Payment.countDocuments(effectiveFilter),
  ]);
  return { items, total };
}
