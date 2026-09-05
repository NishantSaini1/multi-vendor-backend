import { IOrder } from '../models/Order';
import { NOTIFICATION_TYPES } from '../constants/enums';
import * as notificationService from '../services/notification.service';

// Shared by order.service (vendor-driven pre-pickup transitions) and
// delivery.service (partner-assignment/in-transit transitions) — both call
// this after their own status change has already been persisted, so the
// customer-facing notification for a given order status only has one
// definition regardless of which service actually drove that transition.
const ORDER_STATUS_NOTIFICATION: Partial<Record<string, { type: string; title: string; body: (order: IOrder) => string }>> = {
  CONFIRMED: {
    type: NOTIFICATION_TYPES.ORDER_CONFIRMED,
    title: 'Order confirmed',
    body: (order) => `Your order ${order.orderNumber} has been confirmed.`,
  },
  PREPARING: {
    type: NOTIFICATION_TYPES.ORDER_PREPARING,
    title: 'Order is being prepared',
    body: (order) => `Your order ${order.orderNumber} is being prepared.`,
  },
  PACKING: {
    type: NOTIFICATION_TYPES.ORDER_PREPARING,
    title: 'Order is being packed',
    body: (order) => `Your order ${order.orderNumber} is being packed.`,
  },
  READY_FOR_PICKUP: {
    type: NOTIFICATION_TYPES.ORDER_READY,
    title: 'Order is ready',
    body: (order) => `Your order ${order.orderNumber} is ready for pickup.`,
  },
  PARTNER_ASSIGNED: {
    type: NOTIFICATION_TYPES.PARTNER_ASSIGNED,
    title: 'Delivery partner assigned',
    body: (order) => `A delivery partner has been assigned to your order ${order.orderNumber}.`,
  },
  PICKED_UP: {
    type: NOTIFICATION_TYPES.ORDER_PICKED_UP,
    title: 'Order picked up',
    body: (order) => `Your order ${order.orderNumber} has been picked up.`,
  },
  OUT_FOR_DELIVERY: {
    type: NOTIFICATION_TYPES.ORDER_OUT_FOR_DELIVERY,
    title: 'Out for delivery',
    body: (order) => `Your order ${order.orderNumber} is out for delivery.`,
  },
  DELIVERED: {
    type: NOTIFICATION_TYPES.ORDER_DELIVERED,
    title: 'Order delivered',
    body: (order) => `Your order ${order.orderNumber} has been delivered. Enjoy!`,
  },
  CANCELLED: {
    type: NOTIFICATION_TYPES.ORDER_CANCELLED,
    title: 'Order cancelled',
    body: (order) => `Your order ${order.orderNumber} has been cancelled.`,
  },
};

export async function notifyOrderStatusChange(order: IOrder, status: string): Promise<void> {
  const config = ORDER_STATUS_NOTIFICATION[status];
  if (!config) return;
  await notificationService.notify(order.customerId.toString(), 'CUSTOMER', config.type, config.title, config.body(order), {
    orderId: order.id,
    status,
  });
}
