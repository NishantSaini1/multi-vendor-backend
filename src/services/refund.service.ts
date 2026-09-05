import mongoose from 'mongoose';
import { Refund, IRefund } from '../models/Refund';
import { Payment } from '../models/Payment';
import { Order, IOrder } from '../models/Order';
import { razorpay } from '../config/razorpay';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { assertLocationAccess, locationScopeFilter } from '../middleware/rbac.middleware';
import { PAYMENT_METHODS, PAYMENT_STATUS, REFUND_STATUS, REFUND_TYPES, WALLET_TRANSACTION_TYPES } from '../constants/paymentStatus';
import { NOTIFICATION_TYPES } from '../constants/enums';
import * as walletService from './wallet.service';
import * as notificationService from './notification.service';
import { logger } from '../utils/logger';

async function findPaymentForOrder(orderId: string) {
  const payment = await Payment.findOne({ orderId, status: { $in: [PAYMENT_STATUS.PAID, PAYMENT_STATUS.PARTIALLY_REFUNDED] } }).sort({
    createdAt: -1,
  });
  if (!payment) throw ApiError.notFound('No paid payment found for this order', 'PAYMENT_NOT_FOUND');
  return payment;
}

function refundableAmount(payment: InstanceType<typeof Payment>, alreadyRefunded: number): number {
  return payment.amount - alreadyRefunded;
}

async function totalRefundedForPayment(paymentId: string): Promise<number> {
  const refunds = await Refund.find({ paymentId, status: REFUND_STATUS.COMPLETED });
  return refunds.reduce((sum, r) => sum + r.amount, 0);
}

// Credits/refunds the given amount to whatever the customer actually paid
// with — a Razorpay refund for RAZORPAY payments, a wallet credit for
// WALLET/COD payments (COD "payment" only exists here if it was somehow
// marked PAID out of band; in practice COD orders reach this only via the
// PAID branch, which today only WALLET and RAZORPAY set).
async function executeRefund(payment: InstanceType<typeof Payment>, amount: number, refund: InstanceType<typeof Refund>) {
  if (payment.method === PAYMENT_METHODS.RAZORPAY) {
    if (!payment.razorpayPaymentId) {
      throw ApiError.unprocessable('Payment has no captured Razorpay payment to refund', 'REFUND_NOT_POSSIBLE');
    }
    try {
      const razorpayRefund = await razorpay.payments.refund(payment.razorpayPaymentId, {
        amount: Math.round(amount * 100),
      });
      refund.razorpayRefundId = razorpayRefund.id;
      refund.status = REFUND_STATUS.COMPLETED;
      refund.processedAt = new Date();
      await refund.save();
    } catch (err) {
      refund.status = REFUND_STATUS.FAILED;
      await refund.save();
      logger.error({ err, paymentId: payment.id }, 'Razorpay refund failed');
      throw ApiError.internal('Refund could not be processed with the payment gateway', 'REFUND_GATEWAY_ERROR');
    }
  } else {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await walletService.creditWallet(
          payment.customerId.toString(),
          amount,
          WALLET_TRANSACTION_TYPES.REFUND,
          refund.id,
          `Refund for order`,
          session,
        );
      });
      refund.status = REFUND_STATUS.COMPLETED;
      refund.processedAt = new Date();
      await refund.save({ session });
    } finally {
      await session.endSession();
    }
  }
}

async function finalizeOrderPaymentStatus(orderId: mongoose.Types.ObjectId, paymentId: string) {
  const [totalRefunded, payment] = await Promise.all([totalRefundedForPayment(paymentId), Payment.findById(paymentId)]);
  if (!payment) return;

  const newStatus = totalRefunded >= payment.amount ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIALLY_REFUNDED;
  payment.status = newStatus;
  await payment.save();
  await Order.updateOne({ _id: orderId }, { paymentStatus: newStatus });
}

function assertRefundAccess(user: JwtPayload, order: IOrder): void {
  if (user.userType === 'CUSTOMER') {
    if (order.customerId.toString() !== user.userId) {
      throw ApiError.forbidden('You do not have access to this order', 'ORDER_FORBIDDEN');
    }
    return;
  }
  assertLocationAccess(user, order.locationId.toString());
}

export async function createRefund(
  data: { orderId: string; type: 'FULL' | 'PARTIAL'; amount?: number; reason: string },
  user: JwtPayload,
) {
  const order = await Order.findById(data.orderId);
  if (!order) throw ApiError.notFound('Order not found', 'ORDER_NOT_FOUND');
  assertRefundAccess(user, order);

  const payment = await findPaymentForOrder(order.id);
  const alreadyRefunded = await totalRefundedForPayment(payment.id);
  const maxRefundable = refundableAmount(payment, alreadyRefunded);
  if (maxRefundable <= 0) {
    throw ApiError.conflict('This payment has already been fully refunded', 'ALREADY_REFUNDED');
  }

  const amount = data.type === REFUND_TYPES.FULL ? maxRefundable : (data.amount ?? 0);
  if (data.type === REFUND_TYPES.PARTIAL && (!data.amount || data.amount <= 0)) {
    throw ApiError.badRequest('amount is required for a PARTIAL refund', 'REFUND_AMOUNT_REQUIRED');
  }
  if (amount > maxRefundable) {
    throw ApiError.badRequest(`Refund amount cannot exceed the refundable balance of ${maxRefundable}`, 'REFUND_AMOUNT_EXCEEDS_BALANCE');
  }

  const refund = await Refund.create({
    orderId: order.id,
    paymentId: payment.id,
    customerId: order.customerId,
    type: data.type,
    amount,
    reason: data.reason,
    status: REFUND_STATUS.PENDING,
  });

  await executeRefund(payment, amount, refund);
  await finalizeOrderPaymentStatus(order._id, payment.id);
  await notificationService.notify(
    order.customerId.toString(),
    'CUSTOMER',
    NOTIFICATION_TYPES.REFUND_COMPLETED,
    'Refund processed',
    `Your refund of ${amount} for order ${order.orderNumber} has been processed.`,
    { orderId: order.id, refundId: refund.id },
  );

  return refund;
}

// Called from order cancellation once a PAID order is cancelled — the money
// already moved, so cancelling it must not silently strand it. Runs
// best-effort: if the gateway refund fails, the order stays cancelled (that
// transition already committed) but the refund record is left FAILED for
// finance to retry manually via `createRefund`, rather than failing the
// cancellation itself.
export async function autoRefundForCancelledOrder(order: IOrder, reason: string) {
  try {
    const payment = await findPaymentForOrder(order.id);
    const alreadyRefunded = await totalRefundedForPayment(payment.id);
    const amount = refundableAmount(payment, alreadyRefunded);
    if (amount <= 0) return;

    const refund = await Refund.create({
      orderId: order.id,
      paymentId: payment.id,
      customerId: order.customerId,
      type: REFUND_TYPES.FULL,
      amount,
      reason,
      status: REFUND_STATUS.PENDING,
    });

    await executeRefund(payment, amount, refund);
    await finalizeOrderPaymentStatus(order._id, payment.id);
    await notificationService.notify(
      order.customerId.toString(),
      'CUSTOMER',
      NOTIFICATION_TYPES.REFUND_COMPLETED,
      'Refund processed',
      `Your refund of ${amount} for order ${order.orderNumber} has been processed.`,
      { orderId: order.id, refundId: refund.id },
    );
  } catch (err) {
    if (err instanceof ApiError && err.code === 'PAYMENT_NOT_FOUND') return;
    logger.error({ err, orderId: order.id }, 'Auto-refund on order cancellation failed');
  }
}

export async function getRefundById(id: string, user: JwtPayload) {
  const refund = await Refund.findById(id);
  if (!refund) throw ApiError.notFound('Refund not found', 'REFUND_NOT_FOUND');
  const order = await Order.findById(refund.orderId);
  if (order) assertRefundAccess(user, order);
  return refund;
}

export function refundListFilter(user: JwtPayload): Record<string, unknown> {
  if (user.userType === 'CUSTOMER') return { customerId: user.userId };
  return {};
}

export async function listRefunds(filter: Record<string, unknown>, user: JwtPayload, pagination: PaginationParams) {
  let effectiveFilter = filter;
  if (user.userType === 'ADMIN') {
    const orderFilter = locationScopeFilter(user);
    if (Object.keys(orderFilter).length > 0) {
      const orderIds = await Order.find(orderFilter).distinct('_id');
      effectiveFilter = { ...filter, orderId: { $in: orderIds } };
    }
  }

  const [items, total] = await Promise.all([
    Refund.find(effectiveFilter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    Refund.countDocuments(effectiveFilter),
  ]);
  return { items, total };
}

export type { IRefund };
