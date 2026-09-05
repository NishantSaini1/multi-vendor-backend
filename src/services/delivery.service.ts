import mongoose from 'mongoose';
import { Delivery, IDelivery } from '../models/Delivery';
import { DeliveryStatusHistory } from '../models/DeliveryStatusHistory';
import { DeliveryPartner } from '../models/DeliveryPartner';
import { Order } from '../models/Order';
import { OrderStatusHistory } from '../models/OrderStatusHistory';
import { Vendor } from '../models/Vendor';
import { Store } from '../models/Store';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { assertLocationAccess } from '../middleware/rbac.middleware';
import { haversineDistanceKm } from '../utils/geo';
import { markPartnerActive, markPartnerInactive } from './deliveryPartnerLocation.service';
import { notifyOrderStatusChange } from '../utils/orderNotifications';
import {
  DELIVERY_STATUS,
  DELIVERY_TRANSITIONS,
  DELIVERY_TO_ORDER_STATUS,
  DELIVERY_PARTNER_STATUS,
  DELIVERY_PARTNER_AVAILABILITY,
} from '../constants/deliveryStatus';
import { BUSINESS_TYPES } from '../constants/orderStatus';

const DELIVERY_STATUS_TIMESTAMP_FIELD: Record<string, keyof IDelivery | undefined> = {
  ACCEPTED: 'acceptedAt',
  ARRIVED_AT_PICKUP: 'arrivedAtPickupAt',
  PICKED_UP: 'pickedUpAt',
  OUT_FOR_DELIVERY: 'outForDeliveryAt',
  DELIVERED: 'deliveredAt',
};

async function findDeliveryOrThrow(id: string) {
  const delivery = await Delivery.findById(id);
  if (!delivery) throw ApiError.notFound('Delivery not found', 'DELIVERY_NOT_FOUND');
  return delivery;
}

async function assertDeliveryAccess(user: JwtPayload, delivery: IDelivery): Promise<void> {
  if (user.userType === 'DELIVERY_PARTNER') {
    if (delivery.deliveryPartnerId.toString() !== user.userId) {
      throw ApiError.forbidden('You do not have access to this delivery', 'DELIVERY_FORBIDDEN');
    }
    return;
  }

  const order = await Order.findById(delivery.orderId);
  if (!order) throw ApiError.notFound('Order not found', 'ORDER_NOT_FOUND');

  if (user.userType === 'CUSTOMER') {
    if (order.customerId.toString() !== user.userId) throw ApiError.forbidden('You do not have access to this delivery', 'DELIVERY_FORBIDDEN');
    return;
  }
  if (user.userType === 'VENDOR') {
    if (order.vendorId?.toString() !== user.userId) throw ApiError.forbidden('You do not have access to this delivery', 'DELIVERY_FORBIDDEN');
    return;
  }
  assertLocationAccess(user, order.locationId.toString());
}

async function assertPartnerAssignable(partner: InstanceType<typeof DeliveryPartner>, orderLocationId: string): Promise<void> {
  if (partner.status !== DELIVERY_PARTNER_STATUS.ACTIVE) {
    throw ApiError.unprocessable('Delivery partner is not active', 'DELIVERY_PARTNER_NOT_ACTIVE');
  }
  if (partner.availability !== DELIVERY_PARTNER_AVAILABILITY.ONLINE) {
    throw ApiError.unprocessable('Delivery partner is not available', 'DELIVERY_PARTNER_NOT_AVAILABLE');
  }
  // Never assign a partner from another location unless cross-location
  // delivery is explicitly enabled (not implemented — spec section 33).
  if (partner.locationId.toString() !== orderLocationId) {
    throw ApiError.badRequest('Delivery partner does not belong to the order\'s location', 'DELIVERY_PARTNER_LOCATION_MISMATCH');
  }
}

async function resolvePickupPoint(order: InstanceType<typeof Order>) {
  if (order.businessType === BUSINESS_TYPES.FOOD) {
    const vendor = await Vendor.findById(order.vendorId);
    if (!vendor) throw ApiError.notFound('Vendor not found', 'VENDOR_NOT_FOUND');
    return { address: vendor.address, latitude: vendor.latitude, longitude: vendor.longitude };
  }
  const store = await Store.findById(order.storeId);
  if (!store) throw ApiError.notFound('Store not found', 'STORE_NOT_FOUND');
  return { address: store.address, latitude: store.latitude, longitude: store.longitude };
}

export async function assignDeliveryPartner(orderId: string, deliveryPartnerId: string, user: JwtPayload) {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound('Order not found', 'ORDER_NOT_FOUND');
  assertLocationAccess(user, order.locationId.toString());

  if (order.status !== 'READY_FOR_PICKUP') {
    throw ApiError.badRequest('Order must be READY_FOR_PICKUP before a delivery partner can be assigned', 'ORDER_NOT_READY_FOR_ASSIGNMENT');
  }
  if (order.deliveryPartnerId) {
    throw ApiError.conflict('Order already has a delivery partner assigned', 'ORDER_ALREADY_ASSIGNED');
  }

  const partner = await DeliveryPartner.findById(deliveryPartnerId);
  if (!partner) throw ApiError.notFound('Delivery partner not found', 'DELIVERY_PARTNER_NOT_FOUND');
  await assertPartnerAssignable(partner, order.locationId.toString());

  const pickup = await resolvePickupPoint(order);
  const distanceKm = haversineDistanceKm(
    pickup.latitude,
    pickup.longitude,
    order.deliveryAddress.latitude,
    order.deliveryAddress.longitude,
  );

  const session = await mongoose.startSession();
  try {
    let createdDelivery: InstanceType<typeof Delivery> | undefined;

    await session.withTransaction(async () => {
      const [delivery] = await Delivery.create(
        [
          {
            orderId: order.id,
            deliveryPartnerId,
            pickupLocation: pickup,
            dropLocation: {
              address: order.deliveryAddress.address,
              latitude: order.deliveryAddress.latitude,
              longitude: order.deliveryAddress.longitude,
            },
            status: DELIVERY_STATUS.ASSIGNED,
            assignedAt: new Date(),
            distance: distanceKm,
          },
        ],
        { session },
      );

      await DeliveryStatusHistory.create([{ deliveryId: delivery.id, newStatus: DELIVERY_STATUS.ASSIGNED }], { session });

      const oldOrderStatus = order.status;
      order.deliveryPartnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
      order.deliveryId = delivery._id;
      order.status = 'PARTNER_ASSIGNED';
      await order.save({ session });
      await OrderStatusHistory.create(
        [{ orderId: order.id, oldStatus: oldOrderStatus, newStatus: 'PARTNER_ASSIGNED', changedBy: user.userId, changedByType: user.userType }],
        { session },
      );

      partner.availability = DELIVERY_PARTNER_AVAILABILITY.BUSY;
      partner.currentOrderId = order._id;
      await partner.save({ session });

      createdDelivery = delivery;
    });

    await markPartnerInactive(partner.locationId.toString(), partner.id);
    await notifyOrderStatusChange(order, 'PARTNER_ASSIGNED');
    return createdDelivery!;
  } finally {
    await session.endSession();
  }
}

export async function reassignDeliveryPartner(orderId: string, newDeliveryPartnerId: string, reason: string, user: JwtPayload) {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound('Order not found', 'ORDER_NOT_FOUND');
  assertLocationAccess(user, order.locationId.toString());

  const delivery = await Delivery.findOne({ orderId });
  if (!delivery) throw ApiError.notFound('Delivery not found for this order', 'DELIVERY_NOT_FOUND');
  if (![DELIVERY_STATUS.ASSIGNED, DELIVERY_STATUS.ACCEPTED].includes(delivery.status as typeof DELIVERY_STATUS.ASSIGNED)) {
    throw ApiError.badRequest('Delivery can only be reassigned before pickup', 'DELIVERY_NOT_REASSIGNABLE');
  }

  const newPartner = await DeliveryPartner.findById(newDeliveryPartnerId);
  if (!newPartner) throw ApiError.notFound('Delivery partner not found', 'DELIVERY_PARTNER_NOT_FOUND');
  await assertPartnerAssignable(newPartner, order.locationId.toString());

  const oldPartnerId = delivery.deliveryPartnerId.toString();
  const oldPartner = await DeliveryPartner.findById(oldPartnerId);

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const oldDeliveryStatus = delivery.status;
      delivery.deliveryPartnerId = newPartner._id;
      delivery.status = DELIVERY_STATUS.ASSIGNED;
      delivery.assignedAt = new Date();
      delivery.acceptedAt = undefined;
      await delivery.save({ session });

      await DeliveryStatusHistory.create(
        [{ deliveryId: delivery.id, oldStatus: oldDeliveryStatus, newStatus: DELIVERY_STATUS.ASSIGNED }],
        { session },
      );

      order.deliveryPartnerId = newPartner._id;
      await order.save({ session });

      // Order status itself doesn't change on reassignment (still
      // PARTNER_ASSIGNED) — record the reassignment reason as a same-status
      // history entry so it's visible on the order timeline.
      await OrderStatusHistory.create(
        [
          {
            orderId: order.id,
            oldStatus: order.status,
            newStatus: order.status,
            changedBy: user.userId,
            changedByType: user.userType,
            reason: `Reassigned from partner ${oldPartnerId} to ${newPartner.id}: ${reason}`,
          },
        ],
        { session },
      );

      if (oldPartner) {
        if (oldPartner.status === DELIVERY_PARTNER_STATUS.ACTIVE) {
          oldPartner.availability = DELIVERY_PARTNER_AVAILABILITY.ONLINE;
        }
        oldPartner.currentOrderId = undefined;
        await oldPartner.save({ session });
      }

      newPartner.availability = DELIVERY_PARTNER_AVAILABILITY.BUSY;
      newPartner.currentOrderId = order._id;
      await newPartner.save({ session });
    });

    await markPartnerInactive(newPartner.locationId.toString(), newPartner.id);
    if (oldPartner && oldPartner.status === DELIVERY_PARTNER_STATUS.ACTIVE && oldPartner.currentLatitude !== undefined && oldPartner.currentLongitude !== undefined) {
      await markPartnerActive(oldPartner.locationId.toString(), oldPartner.id, oldPartner.currentLongitude, oldPartner.currentLatitude);
    }

    return delivery;
  } finally {
    await session.endSession();
  }
}

export async function listDeliveries(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total] = await Promise.all([
    Delivery.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    Delivery.countDocuments(filter),
  ]);
  return { items, total };
}

export async function getDeliveryById(id: string, user: JwtPayload) {
  const delivery = await findDeliveryOrThrow(id);
  await assertDeliveryAccess(user, delivery);
  return delivery;
}

export async function getDeliveryTracking(id: string, user: JwtPayload) {
  const delivery = await findDeliveryOrThrow(id);
  await assertDeliveryAccess(user, delivery);

  const partner = await DeliveryPartner.findById(delivery.deliveryPartnerId);
  return {
    status: delivery.status,
    pickupLocation: delivery.pickupLocation,
    dropLocation: delivery.dropLocation,
    partnerLocation:
      partner?.currentLatitude !== undefined && partner?.currentLongitude !== undefined
        ? { latitude: partner.currentLatitude, longitude: partner.currentLongitude, updatedAt: partner.currentLocationUpdatedAt }
        : null,
    distance: delivery.distance,
    estimatedTime: delivery.estimatedTime,
    assignedAt: delivery.assignedAt,
    acceptedAt: delivery.acceptedAt,
    arrivedAtPickupAt: delivery.arrivedAtPickupAt,
    pickedUpAt: delivery.pickedUpAt,
    outForDeliveryAt: delivery.outForDeliveryAt,
    deliveredAt: delivery.deliveredAt,
  };
}

export async function updateDeliveryStatus(id: string, newStatus: string, user: JwtPayload) {
  const delivery = await findDeliveryOrThrow(id);
  await assertDeliveryAccess(user, delivery);

  const allowed = DELIVERY_TRANSITIONS[delivery.status] ?? [];
  if (!allowed.includes(newStatus)) {
    throw ApiError.badRequest(`Cannot transition delivery from ${delivery.status} to ${newStatus}`, 'INVALID_DELIVERY_STATUS_TRANSITION');
  }

  let orderForNotify: InstanceType<typeof Order> | undefined;
  let mappedOrderStatusForNotify: string | undefined;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const oldStatus = delivery.status;
      delivery.status = newStatus;
      const timestampField = DELIVERY_STATUS_TIMESTAMP_FIELD[newStatus];
      if (timestampField) {
        (delivery as unknown as Record<string, Date>)[timestampField] = new Date();
      }
      await delivery.save({ session });

      await DeliveryStatusHistory.create([{ deliveryId: delivery.id, oldStatus, newStatus }], { session });

      const order = await Order.findById(delivery.orderId).session(session);
      if (!order) throw ApiError.notFound('Order not found', 'ORDER_NOT_FOUND');
      orderForNotify = order;

      const mappedOrderStatus = DELIVERY_TO_ORDER_STATUS[newStatus];
      const partner = await DeliveryPartner.findById(delivery.deliveryPartnerId).session(session);

      if (mappedOrderStatus) {
        const oldOrderStatus = order.status;
        order.status = mappedOrderStatus;
        await order.save({ session });
        await OrderStatusHistory.create(
          [{ orderId: order.id, oldStatus: oldOrderStatus, newStatus: mappedOrderStatus, changedBy: user.userId, changedByType: user.userType }],
          { session },
        );
        mappedOrderStatusForNotify = mappedOrderStatus;

        if (newStatus === DELIVERY_STATUS.DELIVERED && partner) {
          partner.availability = DELIVERY_PARTNER_AVAILABILITY.ONLINE;
          partner.currentOrderId = undefined;
          partner.totalOrders += 1;
          partner.completedOrders += 1;
          await partner.save({ session });
        }
      }

      if ((newStatus === DELIVERY_STATUS.CANCELLED || newStatus === DELIVERY_STATUS.FAILED) && partner) {
        partner.availability = DELIVERY_PARTNER_AVAILABILITY.ONLINE;
        partner.currentOrderId = undefined;
        partner.totalOrders += 1;
        partner.cancelledOrders += 1;
        await partner.save({ session });

        const oldOrderStatus = order.status;
        order.deliveryPartnerId = undefined;
        order.status = 'READY_FOR_PICKUP';
        await order.save({ session });
        await OrderStatusHistory.create(
          [
            {
              orderId: order.id,
              oldStatus: oldOrderStatus,
              newStatus: 'READY_FOR_PICKUP',
              changedBy: user.userId,
              changedByType: user.userType,
              reason: `Reverted for reassignment after delivery ${newStatus}`,
            },
          ],
          { session },
        );
      }
    });

    const partner = await DeliveryPartner.findById(delivery.deliveryPartnerId);
    if (partner && partner.availability === DELIVERY_PARTNER_AVAILABILITY.ONLINE && partner.currentLatitude !== undefined && partner.currentLongitude !== undefined) {
      await markPartnerActive(partner.locationId.toString(), partner.id, partner.currentLongitude, partner.currentLatitude);
    }

    if (orderForNotify && mappedOrderStatusForNotify) {
      await notifyOrderStatusChange(orderForNotify, mappedOrderStatusForNotify);
    }

    return delivery;
  } finally {
    await session.endSession();
  }
}
