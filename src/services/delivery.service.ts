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
import * as ledgerService from './ledger.service';
import {
  DELIVERY_STATUS,
  DELIVERY_TRANSITIONS,
  DELIVERY_TO_ORDER_STATUS,
  DELIVERY_PARTNER_STATUS,
  DELIVERY_PARTNER_AVAILABILITY,
  DELIVERY_ASSIGNMENT_MODE,
} from '../constants/deliveryStatus';
import { NOTIFICATION_TYPES } from '../constants/enums';
import * as notificationService from './notification.service';
import { logger } from '../utils/logger';
import { SYSTEM_ACTOR } from '../utils/systemActor';
import { BUSINESS_TYPES } from '../constants/orderStatus';
import { TRANSACTION_TYPE, TRANSACTION_DIRECTION } from '../constants/enums';
import { PAYMENT_METHODS, PAYMENT_STATUS } from '../constants/paymentStatus';
import { Payment } from '../models/Payment';
import { env } from '../config/env';
import { generateOtp, hashOtp, verifyOtpHash } from '../utils/otp';
import { uploadImageBuffer } from './upload.service';

const DELIVERY_STATUS_TIMESTAMP_FIELD: Record<string, keyof IDelivery | undefined> = {
  ARRIVED_AT_VENDOR: 'arrivedAtVendorAt',
  PICKED_UP: 'pickedUpAt',
  OUT_FOR_DELIVERY: 'outForDeliveryAt',
  ARRIVED_AT_CUSTOMER: 'arrivedAtCustomerAt',
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

// Who performed an assignment, for the order history. Auto-assignment has no
// human actor, so it records the shared SYSTEM_ACTOR (utils/systemActor.ts).
type AssignmentActor = Pick<JwtPayload, 'userId' | 'userType'>;

// The one place an order actually gets a partner, shared by an admin's manual
// assign and auto-assignment. Race-safe: the order is only claimed while it's
// still READY_FOR_PICKUP with no partner, and the partner only while still
// ACTIVE + ONLINE, so two concurrent assignments can never double-book either.
// Reuses the order's Delivery when a previous partner cancelled/failed it
// (Delivery.orderId is unique — one Delivery per order, many partners over time).
async function performAssignment(
  order: InstanceType<typeof Order>,
  partner: InstanceType<typeof DeliveryPartner>,
  mode: string,
  actor: AssignmentActor,
) {
  const pickup = await resolvePickupPoint(order);
  const distanceKm = haversineDistanceKm(
    pickup.latitude,
    pickup.longitude,
    order.deliveryAddress.latitude,
    order.deliveryAddress.longitude,
  );

  const session = await mongoose.startSession();
  let assigned: InstanceType<typeof Delivery> | undefined;
  let claimedOrder: InstanceType<typeof Order> | null = null;
  try {
    await session.withTransaction(async () => {
      claimedOrder = await Order.findOneAndUpdate(
        { _id: order._id, status: 'READY_FOR_PICKUP', deliveryPartnerId: null },
        { $set: { status: 'PARTNER_ASSIGNED', deliveryPartnerId: partner._id } },
        { new: true, session },
      );
      if (!claimedOrder) {
        throw ApiError.conflict('Order already has a delivery partner assigned or is not ready for pickup', 'ORDER_ALREADY_ASSIGNED');
      }

      const claimedPartner = await DeliveryPartner.findOneAndUpdate(
        { _id: partner._id, status: DELIVERY_PARTNER_STATUS.ACTIVE, availability: DELIVERY_PARTNER_AVAILABILITY.ONLINE },
        { $set: { availability: DELIVERY_PARTNER_AVAILABILITY.BUSY, currentOrderId: order._id } },
        { new: true, session },
      );
      if (!claimedPartner) {
        throw ApiError.unprocessable('Delivery partner is not available', 'DELIVERY_PARTNER_NOT_AVAILABLE');
      }

      // Snapshotted now, at assignment — the delivery partner's earning is
      // fixed at this point rather than recomputed later against whatever
      // the platform's margin config happens to be at DELIVERED time.
      const deliveryFee = order.deliveryFee;
      const partnerEarning = deliveryFee * (1 - env.PLATFORM_DELIVERY_MARGIN_PERCENT / 100);
      const fields = {
        deliveryPartnerId: partner._id,
        pickupLocation: pickup,
        dropLocation: {
          address: order.deliveryAddress.address,
          latitude: order.deliveryAddress.latitude,
          longitude: order.deliveryAddress.longitude,
        },
        status: DELIVERY_STATUS.ASSIGNED,
        assignedAt: new Date(),
        distance: distanceKm,
        deliveryFee,
        partnerEarning,
        assignmentMode: mode,
      };

      const existing = await Delivery.findOne({ orderId: order._id }).session(session);
      let delivery: InstanceType<typeof Delivery>;
      let oldDeliveryStatus: string | undefined;
      if (existing) {
        oldDeliveryStatus = existing.status;
        Object.assign(existing, fields, {
          arrivedAtVendorAt: undefined,
          pickedUpAt: undefined,
          outForDeliveryAt: undefined,
          arrivedAtCustomerAt: undefined,
          vendorOtpHash: undefined,
          vendorOtpVerified: undefined,
          customerOtpHash: undefined,
          customerOtpVerified: undefined,
          pickupImageUrl: undefined,
          pickupImagePublicId: undefined,
          pickupLatitude: undefined,
          pickupLongitude: undefined,
          pickupTimestamp: undefined,
          deliveryImageUrl: undefined,
          deliveryImagePublicId: undefined,
          deliveryLatitude: undefined,
          deliveryLongitude: undefined,
          deliveryTimestamp: undefined,
        });
        delivery = await existing.save({ session });
      } else {
        [delivery] = await Delivery.create([{ orderId: order._id, ...fields }], { session });
      }

      await DeliveryStatusHistory.create(
        [{ deliveryId: delivery.id, oldStatus: oldDeliveryStatus, newStatus: DELIVERY_STATUS.ASSIGNED }],
        { session },
      );

      claimedOrder.deliveryId = delivery._id;
      await claimedOrder.save({ session });
      await OrderStatusHistory.create(
        [
          {
            orderId: order.id,
            oldStatus: 'READY_FOR_PICKUP',
            newStatus: 'PARTNER_ASSIGNED',
            changedBy: actor.userId,
            changedByType: actor.userType,
            ...(mode === DELIVERY_ASSIGNMENT_MODE.AUTO ? { reason: `Auto-assigned to nearest available partner ${partner.id}` } : {}),
          },
        ],
        { session },
      );

      assigned = delivery;
    });
  } finally {
    await session.endSession();
  }

  await markPartnerInactive(partner.locationId.toString(), partner.id);
  await notifyOrderStatusChange(claimedOrder!, 'PARTNER_ASSIGNED');
  await notifyPartnerOfAssignment(partner.id, claimedOrder!, assigned!);
  return assigned!;
}

async function notifyPartnerOfAssignment(partnerId: string, order: InstanceType<typeof Order>, delivery: InstanceType<typeof Delivery>) {
  await notificationService.notify(
    partnerId,
    'DELIVERY_PARTNER',
    NOTIFICATION_TYPES.DELIVERY_ASSIGNED,
    'New delivery assigned',
    `Order ${order.orderNumber} — pickup at ${delivery.pickupLocation.address}. Accept or decline in the app.`,
    { orderId: order.id, deliveryId: delivery.id },
  );
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

  return performAssignment(order, partner, DELIVERY_ASSIGNMENT_MODE.MANUAL, user);
}

// ACTIVE + ONLINE partners of a location within radiusKm of a point, nearest
// first. Reads each partner's last reported position straight from Mongo
// (the source of truth) rather than the Redis/in-memory GEO set, which is
// empty after a restart without Redis. Shared by auto-assignment and the
// admin's GET /delivery/available-partners.
export async function findOnlinePartnersNear(
  locationId: string,
  latitude: number,
  longitude: number,
  radiusKm: number,
  excludePartnerIds: string[] = [],
) {
  const partners = await DeliveryPartner.find({
    locationId,
    status: DELIVERY_PARTNER_STATUS.ACTIVE,
    availability: DELIVERY_PARTNER_AVAILABILITY.ONLINE,
    _id: { $nin: excludePartnerIds },
    currentLatitude: { $ne: null },
    currentLongitude: { $ne: null },
  });
  return partners
    .map((partner) => ({
      partner,
      distanceKm: haversineDistanceKm(latitude, longitude, partner.currentLatitude!, partner.currentLongitude!),
    }))
    .filter((c) => c.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

// Auto-assignment candidates for an order: near its pickup point within
// AUTO_ASSIGN_RADIUS_KM, skipping anyone who already declined it.
async function rankAutoAssignCandidates(order: InstanceType<typeof Order>, excludePartnerIds: string[]) {
  const pickup = await resolvePickupPoint(order);
  return findOnlinePartnersNear(order.locationId.toString(), pickup.latitude, pickup.longitude, env.AUTO_ASSIGN_RADIUS_KM, excludePartnerIds);
}

// Offers a READY_FOR_PICKUP order with no partner to the nearest available
// partner who hasn't declined it. Called when an order becomes
// READY_FOR_PICKUP, right after a partner declines/fails a delivery, and by
// the every-minute sweep (jobs/deliveryAutoAssign.job.ts) for orders that had
// no one free earlier. Never throws: returns the new Delivery, or null when
// auto-assignment is off, the order isn't waiting for a partner, or nobody
// suitable is online right now (an admin can still assign manually).
export async function autoAssignDeliveryPartner(orderId: string) {
  if (!env.AUTO_ASSIGN_DELIVERY) return null;
  try {
    const order = await Order.findById(orderId);
    if (!order || order.status !== 'READY_FOR_PICKUP' || order.deliveryPartnerId) return null;

    const existing = await Delivery.findOne({ orderId: order._id }, { declinedPartnerIds: 1 });
    const declined = (existing?.declinedPartnerIds ?? []).map((id) => id.toString());

    for (const { partner } of await rankAutoAssignCandidates(order, declined)) {
      try {
        return await performAssignment(order, partner, DELIVERY_ASSIGNMENT_MODE.AUTO, SYSTEM_ACTOR);
      } catch (err) {
        // Someone else claimed this partner in the meantime — try the next one.
        if (err instanceof ApiError && err.code === 'DELIVERY_PARTNER_NOT_AVAILABLE') continue;
        // The order itself was claimed (e.g. an admin assigned it) — done.
        if (err instanceof ApiError && err.code === 'ORDER_ALREADY_ASSIGNED') return null;
        throw err;
      }
    }
    return null;
  } catch (err) {
    logger.error({ err, orderId }, 'Delivery auto-assignment failed');
    return null;
  }
}

// Every-minute sweep: (1) an auto-assigned partner who hasn't accepted within
// AUTO_ASSIGN_ACCEPT_TIMEOUT_SECONDS is treated as having declined and the
// order moves on to the next nearest partner; (2) any READY_FOR_PICKUP order
// still without a partner (nobody was free before) gets another attempt.
export async function runDeliveryAutoAssignSweep() {
  if (!env.AUTO_ASSIGN_DELIVERY) return { timedOut: 0, assigned: 0 };

  let timedOut = 0;
  const cutoff = new Date(Date.now() - env.AUTO_ASSIGN_ACCEPT_TIMEOUT_SECONDS * 1000);
  const stale = await Delivery.find({ status: DELIVERY_STATUS.ASSIGNED, assignmentMode: DELIVERY_ASSIGNMENT_MODE.AUTO, assignedAt: { $lte: cutoff } });
  for (const delivery of stale) {
    try {
      await releaseDeclinedDelivery(delivery.id, 'No response within the acceptance window');
      timedOut += 1;
    } catch (err) {
      logger.error({ err, deliveryId: delivery.id }, 'Failed to release an unaccepted auto-assigned delivery');
    }
  }

  let assigned = 0;
  const waiting = await Order.find({ status: 'READY_FOR_PICKUP', deliveryPartnerId: null }, { _id: 1 }).limit(200);
  for (const order of waiting) {
    if (await autoAssignDeliveryPartner(order.id)) assigned += 1;
  }
  return { timedOut, assigned };
}

// Takes an ASSIGNED delivery away from a partner who didn't respond in time:
// the partner goes back ONLINE, is recorded as having declined, and the order
// returns to READY_FOR_PICKUP for the next attempt.
async function releaseDeclinedDelivery(deliveryId: string, reason: string) {
  const session = await mongoose.startSession();
  let released: InstanceType<typeof Delivery> | null = null;
  try {
    await session.withTransaction(async () => {
      released = await Delivery.findOneAndUpdate(
        { _id: deliveryId, status: DELIVERY_STATUS.ASSIGNED },
        { $set: { status: DELIVERY_STATUS.CANCELLED } },
        { new: true, session },
      );
      if (!released) return; // accepted or cancelled meanwhile
      const partnerId = released.deliveryPartnerId;
      await Delivery.updateOne({ _id: deliveryId }, { $addToSet: { declinedPartnerIds: partnerId } }, { session });
      await DeliveryStatusHistory.create(
        [{ deliveryId, oldStatus: DELIVERY_STATUS.ASSIGNED, newStatus: DELIVERY_STATUS.CANCELLED }],
        { session },
      );
      await DeliveryPartner.updateOne(
        { _id: partnerId, status: DELIVERY_PARTNER_STATUS.ACTIVE, currentOrderId: released.orderId },
        { $set: { availability: DELIVERY_PARTNER_AVAILABILITY.ONLINE }, $unset: { currentOrderId: 1 } },
        { session },
      );
      await Order.updateOne(
        { _id: released.orderId, status: 'PARTNER_ASSIGNED' },
        { $set: { status: 'READY_FOR_PICKUP' }, $unset: { deliveryPartnerId: 1 } },
        { session },
      );
      await OrderStatusHistory.create(
        [
          {
            orderId: released.orderId,
            oldStatus: 'PARTNER_ASSIGNED',
            newStatus: 'READY_FOR_PICKUP',
            changedBy: SYSTEM_ACTOR.userId,
            changedByType: SYSTEM_ACTOR.userType,
            reason: `Partner ${partnerId.toString()}: ${reason}`,
          },
        ],
        { session },
      );
    });
  } finally {
    await session.endSession();
  }

  if (released) {
    const partner = await DeliveryPartner.findById((released as InstanceType<typeof Delivery>).deliveryPartnerId);
    if (partner && partner.availability === DELIVERY_PARTNER_AVAILABILITY.ONLINE && partner.currentLatitude !== undefined && partner.currentLongitude !== undefined) {
      await markPartnerActive(partner.locationId.toString(), partner.id, partner.currentLongitude, partner.currentLatitude);
    }
  }
}

export async function reassignDeliveryPartner(orderId: string, newDeliveryPartnerId: string, reason: string, user: JwtPayload) {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound('Order not found', 'ORDER_NOT_FOUND');
  assertLocationAccess(user, order.locationId.toString());

  const delivery = await Delivery.findOne({ orderId });
  if (!delivery) throw ApiError.notFound('Delivery not found for this order', 'DELIVERY_NOT_FOUND');
  if (![DELIVERY_STATUS.ASSIGNED, DELIVERY_STATUS.ARRIVED_AT_VENDOR].includes(delivery.status as typeof DELIVERY_STATUS.ASSIGNED)) {
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
      delivery.arrivedAtVendorAt = undefined;
      delivery.vendorOtpHash = undefined;
      delivery.vendorOtpVerified = undefined;
      // An admin's pick — the acceptance-timeout sweep leaves it alone.
      delivery.assignmentMode = DELIVERY_ASSIGNMENT_MODE.MANUAL;
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

    await notifyPartnerOfAssignment(newPartner.id, order, delivery);
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
    arrivedAtVendorAt: delivery.arrivedAtVendorAt,
    pickedUpAt: delivery.pickedUpAt,
    outForDeliveryAt: delivery.outForDeliveryAt,
    arrivedAtCustomerAt: delivery.arrivedAtCustomerAt,
    deliveredAt: delivery.deliveredAt,
    pickupProof: delivery.pickupImageUrl ? { imageUrl: delivery.pickupImageUrl, latitude: delivery.pickupLatitude, longitude: delivery.pickupLongitude, timestamp: delivery.pickupTimestamp } : null,
    deliveryProof: delivery.deliveryImageUrl ? { imageUrl: delivery.deliveryImageUrl, latitude: delivery.deliveryLatitude, longitude: delivery.deliveryLongitude, timestamp: delivery.deliveryTimestamp } : null,
    vendorOtpVerified: delivery.vendorOtpVerified,
    customerOtpVerified: delivery.customerOtpVerified,
  };
}

// PARTIALLY_REFUNDED still means the customer paid — some of it was just
// refunded later (e.g. a missing item) — so it counts as settled here.
const SETTLED_PAYMENT_STATUSES: string[] = [PAYMENT_STATUS.PAID, PAYMENT_STATUS.PARTIALLY_REFUNDED];

function buildPaymentSummary(order: InstanceType<typeof Order>) {
  const isPaid = SETTLED_PAYMENT_STATUSES.includes(order.paymentStatus);
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    isPaid,
    orderTotal: order.total,
    // What the partner must physically collect at the door — only ever
    // non-zero for an unpaid COD order.
    amountToCollect: !isPaid && order.paymentMethod === PAYMENT_METHODS.COD ? order.total : 0,
  };
}

// The delivery partner's "has this order been paid?" check before handing
// the order over — see updateDeliveryStatus's DELIVERED guard below.
export async function getDeliveryPaymentStatus(id: string, user: JwtPayload) {
  const delivery = await findDeliveryOrThrow(id);
  await assertDeliveryAccess(user, delivery);

  const order = await Order.findById(delivery.orderId);
  if (!order) throw ApiError.notFound('Order not found', 'ORDER_NOT_FOUND');
  return buildPaymentSummary(order);
}

export interface UpdateDeliveryStatusOptions {
  // COD only: the partner confirms they took the cash at the door, which
  // records the order as PAID in the same transaction that marks it DELIVERED.
  cashCollected?: boolean;
}

export async function updateDeliveryStatus(id: string, newStatus: string, user: JwtPayload, options: UpdateDeliveryStatusOptions = {}) {
  const delivery = await findDeliveryOrThrow(id);
  await assertDeliveryAccess(user, delivery);

  const allowed = DELIVERY_TRANSITIONS[delivery.status] ?? [];
  if (!allowed.includes(newStatus)) {
    throw ApiError.badRequest(`Cannot transition delivery from ${delivery.status} to ${newStatus}`, 'INVALID_DELIVERY_STATUS_TRANSITION');
  }

  // An order can only be handed over once it's paid for: online/wallet
  // orders must already be PAID, and a COD order needs the partner to
  // confirm the cash was collected (cashCollected: true).
  let collectCodPayment = false;
  if (newStatus === DELIVERY_STATUS.DELIVERED) {
    const order = await Order.findById(delivery.orderId);
    if (!order) throw ApiError.notFound('Order not found', 'ORDER_NOT_FOUND');
    const summary = buildPaymentSummary(order);
    if (!summary.isPaid) {
      if (order.paymentMethod !== PAYMENT_METHODS.COD) {
        throw ApiError.unprocessable('Payment for this order has not been completed yet', 'PAYMENT_NOT_COMPLETED');
      }
      if (!options.cashCollected) {
        throw ApiError.unprocessable(
          `Collect ${summary.amountToCollect} in cash and confirm it (cashCollected: true) before marking this order delivered`,
          'COD_CASH_NOT_COLLECTED',
        );
      }
      collectCodPayment = true;
    }
  }

  let orderForNotify: InstanceType<typeof Order> | undefined;
  let mappedOrderStatusForNotify: string | undefined;
  let revertedForReassignment = false;

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

        if (collectCodPayment) {
          const [payment] = await Payment.create(
            [
              {
                orderId: order.id,
                customerId: order.customerId,
                amount: order.total,
                method: PAYMENT_METHODS.COD,
                status: PAYMENT_STATUS.PAID,
                paidAt: new Date(),
              },
            ],
            { session },
          );
          order.paymentId = payment._id;
          order.paymentStatus = PAYMENT_STATUS.PAID;
          await order.save({ session });

          // The COD counterpart of the ORDER_PAYMENT entry RAZORPAY records in
          // payment.service.ts's markPaymentPaid and WALLET in createOrder.
          await ledgerService.recordTransaction(
            {
              orderId: order.id,
              vendorId: order.vendorId?.toString(),
              storeId: order.storeId?.toString(),
              type: TRANSACTION_TYPE.ORDER_PAYMENT,
              amount: order.total,
              direction: TRANSACTION_DIRECTION.CREDIT,
            },
            session,
          );
        }

        if (newStatus === DELIVERY_STATUS.DELIVERED && partner) {
          partner.availability = DELIVERY_PARTNER_AVAILABILITY.ONLINE;
          partner.currentOrderId = undefined;
          partner.totalOrders += 1;
          partner.completedOrders += 1;
          await partner.save({ session });

          // Stage 4 ledger entries. Commission/platform-fee use the order's
          // commission SNAPSHOT from creation time (never recomputed here) —
          // this is the real-world path for an order reaching DELIVERED (see
          // ledger.service.ts's recordOrderCommissionLedger for why this is
          // shared with order.service.ts's updateOrderStatus). Delivery
          // earning uses the Delivery's own partnerEarning (snapshotted at
          // assignment time net of the platform's delivery margin — see
          // assignDeliveryPartner above), not the raw order.deliveryFee — the
          // Stage 4 version of this used deliveryFee as a placeholder before
          // partnerEarning existed; this is that refinement. Falls back to
          // deliveryFee for a pre-Stage-5 Delivery record that predates the
          // field. Skipped entirely for a free delivery (nothing earned).
          await ledgerService.recordOrderCommissionLedger(order, session);
          const earning = delivery.partnerEarning ?? order.deliveryFee;
          if (earning > 0) {
            await ledgerService.recordTransaction(
              {
                orderId: order.id,
                deliveryPartnerId: partner.id,
                type: TRANSACTION_TYPE.DELIVERY_EARNING,
                amount: earning,
                direction: TRANSACTION_DIRECTION.CREDIT,
              },
              session,
            );
          }
        }
      }

      if ((newStatus === DELIVERY_STATUS.CANCELLED || newStatus === DELIVERY_STATUS.FAILED) && partner) {
        // Auto-assignment won't offer this order to them again.
        await Delivery.updateOne({ _id: delivery._id }, { $addToSet: { declinedPartnerIds: partner._id } }, { session });
        revertedForReassignment = true;
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

    // Auto-generate and push customer OTP when partner picks up and goes out for delivery.
    if (newStatus === DELIVERY_STATUS.OUT_FOR_DELIVERY && orderForNotify) {
      try {
        await _generateAndSendCustomerOtp(delivery, orderForNotify);
      } catch (err) {
        logger.error({ err, deliveryId: delivery.id }, 'Failed to auto-generate customer OTP on OUT_FOR_DELIVERY');
      }
    }

    // The partner declined/failed it — offer the order to the next nearest
    // available partner straight away.
    if (revertedForReassignment) {
      await autoAssignDeliveryPartner(delivery.orderId.toString());
    }

    return delivery;
  } finally {
    await session.endSession();
  }
}

// Internal helper — generates a customer OTP and stores both the plaintext
// (for display in the customer app) and the hash (for partner verification).
// No SMS/notification is sent — the customer sees the OTP in their app's
// order/delivery details screen via GET /deliveries/:id/customer-otp.
async function _generateAndSendCustomerOtp(delivery: InstanceType<typeof Delivery>, _order: InstanceType<typeof Order>) {
  const otp = generateOtp();
  const otpHash = hashOtp(otp, delivery.orderId.toString());
  await Delivery.updateOne({ _id: delivery._id }, { $set: { customerOtpCode: otp, customerOtpHash: otpHash, customerOtpVerified: false } });
}

// Generate (or regenerate) the vendor pickup OTP. Returns the plaintext OTP
// for the vendor to display — only the hash is persisted on the Delivery doc.
// Callable by VENDOR (owning this order) or ADMIN.
export async function generateVendorOtp(deliveryId: string, user: JwtPayload): Promise<{ otp: string }> {
  if (user.userType !== 'VENDOR' && user.userType !== 'ADMIN') {
    throw ApiError.forbidden('Only a vendor or admin can generate the pickup OTP', 'FORBIDDEN');
  }

  const delivery = await Delivery.findById(deliveryId).select('+vendorOtpCode +vendorOtpHash');
  if (!delivery) throw ApiError.notFound('Delivery not found', 'DELIVERY_NOT_FOUND');
  await assertDeliveryAccess(user, delivery);

  if (![DELIVERY_STATUS.ASSIGNED, DELIVERY_STATUS.ARRIVED_AT_VENDOR].includes(delivery.status as typeof DELIVERY_STATUS.ASSIGNED)) {
    throw ApiError.badRequest('Vendor OTP can only be generated when the delivery is ASSIGNED or ARRIVED_AT_VENDOR', 'INVALID_STATUS');
  }

  const otp = generateOtp();
  const otpHash = hashOtp(otp, delivery.orderId.toString());
  delivery.vendorOtpCode = otp;
  delivery.vendorOtpHash = otpHash;
  delivery.vendorOtpVerified = false;
  await delivery.save();

  // OTP is returned here for immediate display; it is also persisted so the
  // vendor can re-fetch it from GET /deliveries/:id/vendor-otp anytime.
  return { otp };
}

// Returns the current vendor pickup OTP for display in the vendor app.
// Only accessible to the owning vendor or admin.
export async function getVendorOtp(deliveryId: string, user: JwtPayload): Promise<{ otp: string | null; verified: boolean }> {
  if (user.userType !== 'VENDOR' && user.userType !== 'ADMIN') {
    throw ApiError.forbidden('Only a vendor or admin can view the pickup OTP', 'FORBIDDEN');
  }
  const delivery = await Delivery.findById(deliveryId).select('+vendorOtpCode +vendorOtpHash');
  if (!delivery) throw ApiError.notFound('Delivery not found', 'DELIVERY_NOT_FOUND');
  await assertDeliveryAccess(user, delivery);
  return { otp: delivery.vendorOtpCode ?? null, verified: delivery.vendorOtpVerified ?? false };
}

// Returns the current customer delivery OTP for display in the customer app.
// Only accessible to the owning customer or admin.
export async function getCustomerOtp(deliveryId: string, user: JwtPayload): Promise<{ otp: string | null; verified: boolean }> {
  if (user.userType !== 'CUSTOMER' && user.userType !== 'ADMIN') {
    throw ApiError.forbidden('Only a customer or admin can view the delivery OTP', 'FORBIDDEN');
  }
  const delivery = await Delivery.findById(deliveryId).select('+customerOtpCode +customerOtpHash');
  if (!delivery) throw ApiError.notFound('Delivery not found', 'DELIVERY_NOT_FOUND');
  await assertDeliveryAccess(user, delivery);
  return { otp: delivery.customerOtpCode ?? null, verified: delivery.customerOtpVerified ?? false };
}

// Re-generate and resend the customer delivery OTP on demand.
// Callable by CUSTOMER (owning this order) or ADMIN.
export async function generateCustomerOtp(deliveryId: string, user: JwtPayload): Promise<void> {
  if (user.userType !== 'CUSTOMER' && user.userType !== 'ADMIN') {
    throw ApiError.forbidden('Only a customer or admin can regenerate the delivery OTP', 'FORBIDDEN');
  }

  const delivery = await Delivery.findById(deliveryId).select('+customerOtpHash');
  if (!delivery) throw ApiError.notFound('Delivery not found', 'DELIVERY_NOT_FOUND');
  await assertDeliveryAccess(user, delivery);

  if (![DELIVERY_STATUS.OUT_FOR_DELIVERY, DELIVERY_STATUS.ARRIVED_AT_CUSTOMER].includes(delivery.status as typeof DELIVERY_STATUS.OUT_FOR_DELIVERY)) {
    throw ApiError.badRequest('Customer OTP can only be generated when delivery is OUT_FOR_DELIVERY or ARRIVED_AT_CUSTOMER', 'INVALID_STATUS');
  }

  const order = await Order.findById(delivery.orderId);
  if (!order) throw ApiError.notFound('Order not found', 'ORDER_NOT_FOUND');

  await _generateAndSendCustomerOtp(delivery, order);
}

export interface VerifyPickupOptions {
  otp: string;
  imageBuffer: Buffer;
  latitude: number;
  longitude: number;
}

// Delivery partner verifies the vendor OTP at pickup, uploads the package image,
// and transitions the delivery ARRIVED_AT_VENDOR → PICKED_UP.
export async function verifyPickup(deliveryId: string, data: VerifyPickupOptions, user: JwtPayload): Promise<IDelivery> {
  if (user.userType !== 'DELIVERY_PARTNER' && user.userType !== 'ADMIN') {
    throw ApiError.forbidden('Only the delivery partner or admin can verify pickup', 'FORBIDDEN');
  }

  const delivery = await Delivery.findById(deliveryId).select('+vendorOtpCode +vendorOtpHash');
  if (!delivery) throw ApiError.notFound('Delivery not found', 'DELIVERY_NOT_FOUND');
  await assertDeliveryAccess(user, delivery);

  if (delivery.status !== DELIVERY_STATUS.ARRIVED_AT_VENDOR) {
    throw ApiError.badRequest('Delivery must be in ARRIVED_AT_VENDOR status to verify pickup', 'INVALID_STATUS');
  }
  if (!delivery.vendorOtpHash) {
    throw ApiError.badRequest('Vendor OTP has not been generated yet. Ask the vendor to generate it from their app.', 'OTP_NOT_GENERATED');
  }
  if (!verifyOtpHash(data.otp, delivery.orderId.toString(), delivery.vendorOtpHash)) {
    throw ApiError.badRequest('Invalid vendor OTP', 'INVALID_OTP');
  }

  const { url: pickupImageUrl, publicId: pickupImagePublicId } = await uploadImageBuffer(data.imageBuffer, 'delivery-pickup-proofs');

  let orderForNotify: InstanceType<typeof Order> | undefined;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const oldStatus = delivery.status;
      const now = new Date();
      delivery.status = DELIVERY_STATUS.PICKED_UP;
      delivery.pickedUpAt = now;
      delivery.vendorOtpVerified = true;
      delivery.pickupImageUrl = pickupImageUrl;
      delivery.pickupImagePublicId = pickupImagePublicId;
      delivery.pickupLatitude = data.latitude;
      delivery.pickupLongitude = data.longitude;
      delivery.pickupTimestamp = now;
      await delivery.save({ session });

      await DeliveryStatusHistory.create(
        [{ deliveryId: delivery.id, oldStatus, newStatus: DELIVERY_STATUS.PICKED_UP, latitude: data.latitude, longitude: data.longitude }],
        { session },
      );

      const order = await Order.findById(delivery.orderId).session(session);
      if (!order) throw ApiError.notFound('Order not found', 'ORDER_NOT_FOUND');
      orderForNotify = order;
      const oldOrderStatus = order.status;
      order.status = 'PICKED_UP';
      await order.save({ session });
      await OrderStatusHistory.create(
        [{ orderId: order.id, oldStatus: oldOrderStatus, newStatus: 'PICKED_UP', changedBy: user.userId, changedByType: user.userType }],
        { session },
      );
    });
  } finally {
    await session.endSession();
  }

  if (orderForNotify) await notifyOrderStatusChange(orderForNotify, 'PICKED_UP');
  return delivery;
}

export interface VerifyDeliveryOptions {
  otp: string;
  imageBuffer: Buffer;
  latitude: number;
  longitude: number;
  cashCollected?: boolean;
}

// Delivery partner verifies the customer OTP at the drop point, uploads the
// delivery image, and transitions ARRIVED_AT_CUSTOMER → DELIVERED.
export async function verifyDelivery(deliveryId: string, data: VerifyDeliveryOptions, user: JwtPayload): Promise<IDelivery> {
  if (user.userType !== 'DELIVERY_PARTNER' && user.userType !== 'ADMIN') {
    throw ApiError.forbidden('Only the delivery partner or admin can verify delivery', 'FORBIDDEN');
  }

  const delivery = await Delivery.findById(deliveryId).select('+customerOtpCode +customerOtpHash');
  if (!delivery) throw ApiError.notFound('Delivery not found', 'DELIVERY_NOT_FOUND');
  await assertDeliveryAccess(user, delivery);

  if (delivery.status !== DELIVERY_STATUS.ARRIVED_AT_CUSTOMER) {
    throw ApiError.badRequest('Delivery must be in ARRIVED_AT_CUSTOMER status to verify delivery', 'INVALID_STATUS');
  }
  if (!delivery.customerOtpHash) {
    throw ApiError.badRequest('Customer OTP has not been generated yet', 'OTP_NOT_GENERATED');
  }
  if (!verifyOtpHash(data.otp, delivery.orderId.toString(), delivery.customerOtpHash)) {
    throw ApiError.badRequest('Invalid customer OTP', 'INVALID_OTP');
  }

  // Payment guard (same as updateDeliveryStatus's DELIVERED block).
  let collectCodPayment = false;
  const orderCheck = await Order.findById(delivery.orderId);
  if (!orderCheck) throw ApiError.notFound('Order not found', 'ORDER_NOT_FOUND');
  const summary = buildPaymentSummary(orderCheck);
  if (!summary.isPaid) {
    if (orderCheck.paymentMethod !== PAYMENT_METHODS.COD) {
      throw ApiError.unprocessable('Payment for this order has not been completed yet', 'PAYMENT_NOT_COMPLETED');
    }
    if (!data.cashCollected) {
      throw ApiError.unprocessable(
        `Collect ${summary.amountToCollect} in cash and confirm it (cashCollected: true) before marking delivered`,
        'COD_CASH_NOT_COLLECTED',
      );
    }
    collectCodPayment = true;
  }

  const { url: deliveryImageUrl, publicId: deliveryImagePublicId } = await uploadImageBuffer(data.imageBuffer, 'delivery-drop-proofs');

  let orderForNotify: InstanceType<typeof Order> | undefined;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const oldStatus = delivery.status;
      const now = new Date();
      delivery.status = DELIVERY_STATUS.DELIVERED;
      delivery.deliveredAt = now;
      delivery.customerOtpVerified = true;
      delivery.deliveryImageUrl = deliveryImageUrl;
      delivery.deliveryImagePublicId = deliveryImagePublicId;
      delivery.deliveryLatitude = data.latitude;
      delivery.deliveryLongitude = data.longitude;
      delivery.deliveryTimestamp = now;
      await delivery.save({ session });

      await DeliveryStatusHistory.create(
        [{ deliveryId: delivery.id, oldStatus, newStatus: DELIVERY_STATUS.DELIVERED, latitude: data.latitude, longitude: data.longitude }],
        { session },
      );

      const order = await Order.findById(delivery.orderId).session(session);
      if (!order) throw ApiError.notFound('Order not found', 'ORDER_NOT_FOUND');
      orderForNotify = order;
      const oldOrderStatus = order.status;
      order.status = 'DELIVERED';
      await order.save({ session });
      await OrderStatusHistory.create(
        [{ orderId: order.id, oldStatus: oldOrderStatus, newStatus: 'DELIVERED', changedBy: user.userId, changedByType: user.userType }],
        { session },
      );

      if (collectCodPayment) {
        const [payment] = await Payment.create(
          [{ orderId: order.id, customerId: order.customerId, amount: order.total, method: PAYMENT_METHODS.COD, status: PAYMENT_STATUS.PAID, paidAt: now }],
          { session },
        );
        order.paymentId = payment._id;
        order.paymentStatus = PAYMENT_STATUS.PAID;
        await order.save({ session });
        await ledgerService.recordTransaction(
          { orderId: order.id, vendorId: order.vendorId?.toString(), storeId: order.storeId?.toString(), type: TRANSACTION_TYPE.ORDER_PAYMENT, amount: order.total, direction: TRANSACTION_DIRECTION.CREDIT },
          session,
        );
      }

      const partner = await DeliveryPartner.findById(delivery.deliveryPartnerId).session(session);
      if (partner) {
        partner.availability = DELIVERY_PARTNER_AVAILABILITY.ONLINE;
        partner.currentOrderId = undefined;
        partner.totalOrders += 1;
        partner.completedOrders += 1;
        await partner.save({ session });

        await ledgerService.recordOrderCommissionLedger(order, session);
        const earning = delivery.partnerEarning ?? order.deliveryFee;
        if (earning > 0) {
          await ledgerService.recordTransaction(
            { orderId: order.id, deliveryPartnerId: partner.id, type: TRANSACTION_TYPE.DELIVERY_EARNING, amount: earning, direction: TRANSACTION_DIRECTION.CREDIT },
            session,
          );
        }
      }
    });

    const partner = await DeliveryPartner.findById(delivery.deliveryPartnerId);
    if (partner && partner.availability === DELIVERY_PARTNER_AVAILABILITY.ONLINE && partner.currentLatitude !== undefined && partner.currentLongitude !== undefined) {
      await markPartnerActive(partner.locationId.toString(), partner.id, partner.currentLongitude, partner.currentLatitude);
    }
    if (orderForNotify) await notifyOrderStatusChange(orderForNotify, 'DELIVERED');

    return delivery;
  } finally {
    await session.endSession();
  }
}
