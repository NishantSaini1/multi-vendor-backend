import { Order } from '../models/Order';
import { cancelOrder } from '../services/order.service';
import { env } from '../config/env';
import { SYSTEM_ACTOR } from '../utils/systemActor';
import { logger } from '../utils/logger';

// Auto-cancels orders the vendor/store never confirmed in time. Reuses
// order.service.cancelOrder as-is (it already handles inventory release,
// the auto-refund-if-paid path, and the ORDER_CANCELLED notification) —
// this job's only job is finding which orders qualify and driving the same
// cancellation path a customer or admin would.
export async function runOrderTimeoutSweep(): Promise<{ cancelled: number; failed: number }> {
  const cutoff = new Date(Date.now() - env.ORDER_TIMEOUT_MINUTES * 60 * 1000);
  const staleOrders = await Order.find({ status: 'PENDING', createdAt: { $lt: cutoff } });

  let cancelled = 0;
  let failed = 0;
  for (const order of staleOrders) {
    try {
      await cancelOrder(order.id, `Automatically cancelled: not confirmed within ${env.ORDER_TIMEOUT_MINUTES} minutes`, SYSTEM_ACTOR);
      cancelled += 1;
    } catch (err) {
      failed += 1;
      logger.error({ err, orderId: order.id }, 'Order timeout sweep failed to cancel an order');
    }
  }

  if (staleOrders.length > 0) {
    logger.info({ cancelled, failed, total: staleOrders.length }, 'Order timeout sweep completed');
  }
  return { cancelled, failed };
}
