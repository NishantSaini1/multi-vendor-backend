import { Settlement, ISettlement, SETTLEMENT_PAYEE_TYPES } from '../models/Settlement';
import { Order } from '../models/Order';
import { DeliveryPartner } from '../models/DeliveryPartner';
import { Transaction } from '../models/Transaction';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { assertLocationAccess, hasLocationAccess, locationScopeFilter } from '../middleware/rbac.middleware';
import { SETTLEMENT_STATUS } from '../constants/paymentStatus';
import { NOTIFICATION_TYPES, TRANSACTION_TYPE, TRANSACTION_DIRECTION } from '../constants/enums';
import * as ledgerService from './ledger.service';
import * as notificationService from './notification.service';

interface PayeeGroup {
  locationId: string;
  orderIds: string[];
  grossAmount: number;
  commissionAmount: number;
}

// Sources a VENDOR/STORE settlement group from the ledger's VENDOR_COMMISSION
// rows (written once, at order-DELIVERED time — see
// ledger.service.ts's recordOrderCommissionLedger) rather than resolving
// commission fresh here — a historical settlement must always reflect what
// was actually snapshotted on the order, not today's Commission config. The
// commission amount comes straight from the ledger; gross (subtotal -
// discount, the same base the snapshot itself used) still needs a lookup on
// the handful of orders the ledger identified, not a live re-query by
// status/date.
async function buildVendorOrStoreGroups(
  payeeType: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<Map<string, PayeeGroup>> {
  const payeeField = payeeType === SETTLEMENT_PAYEE_TYPES.VENDOR ? 'vendorId' : 'storeId';

  const commissionRows = await Transaction.find({
    type: TRANSACTION_TYPE.VENDOR_COMMISSION,
    [payeeField]: { $exists: true, $ne: null },
    createdAt: { $gte: periodStart, $lt: periodEnd },
  });

  const rowGroups = new Map<string, { orderIds: Set<string>; commissionAmount: number }>();
  for (const row of commissionRows) {
    const payeeId = (row as unknown as Record<string, { toString(): string } | undefined>)[payeeField]?.toString();
    if (!payeeId || !row.orderId) continue;
    let group = rowGroups.get(payeeId);
    if (!group) {
      group = { orderIds: new Set(), commissionAmount: 0 };
      rowGroups.set(payeeId, group);
    }
    group.orderIds.add(row.orderId.toString());
    group.commissionAmount += row.amount;
  }

  const result = new Map<string, PayeeGroup>();
  for (const [payeeId, group] of rowGroups) {
    const orderIds = [...group.orderIds];
    const orders = await Order.find({ _id: { $in: orderIds } }).select('locationId subtotal discount');
    if (orders.length === 0) continue;
    const grossAmount = orders.reduce((sum, o) => sum + (o.subtotal - o.discount), 0);
    result.set(payeeId, {
      locationId: orders[0].locationId.toString(),
      orderIds,
      grossAmount,
      commissionAmount: group.commissionAmount,
    });
  }
  return result;
}

// Delivery partners have no Commission entity of their own (COMMISSION_LEVELS
// has no DELIVERY_PARTNER level) — they keep 100% of the DELIVERY_EARNING
// ledger rows recorded for them (see ledger.service.ts / delivery.service.ts),
// which already equal Delivery.partnerEarning (the order's deliveryFee net
// of the platform's delivery margin, snapshotted at assignment time — see
// env.PLATFORM_DELIVERY_MARGIN_PERCENT), so gross comes straight from the
// ledger with no Order lookup needed at all.
async function buildDeliveryPartnerGroups(periodStart: Date, periodEnd: Date): Promise<Map<string, PayeeGroup>> {
  const earningRows = await Transaction.find({
    type: TRANSACTION_TYPE.DELIVERY_EARNING,
    deliveryPartnerId: { $exists: true, $ne: null },
    createdAt: { $gte: periodStart, $lt: periodEnd },
  });

  const rowGroups = new Map<string, { orderIds: Set<string>; grossAmount: number }>();
  for (const row of earningRows) {
    const payeeId = row.deliveryPartnerId?.toString();
    if (!payeeId) continue;
    let group = rowGroups.get(payeeId);
    if (!group) {
      group = { orderIds: new Set(), grossAmount: 0 };
      rowGroups.set(payeeId, group);
    }
    if (row.orderId) group.orderIds.add(row.orderId.toString());
    group.grossAmount += row.amount;
  }

  const result = new Map<string, PayeeGroup>();
  for (const [payeeId, group] of rowGroups) {
    const partner = await DeliveryPartner.findById(payeeId).select('locationId');
    if (!partner) continue;
    result.set(payeeId, {
      locationId: partner.locationId.toString(),
      orderIds: [...group.orderIds],
      grossAmount: group.grossAmount,
      commissionAmount: 0,
    });
  }
  return result;
}

export async function generateSettlements(
  data: { payeeType: string; periodStart: string; periodEnd: string; locationId?: string },
  user: JwtPayload,
) {
  const periodStart = new Date(data.periodStart);
  const periodEnd = new Date(data.periodEnd);
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime()) || periodStart >= periodEnd) {
    throw ApiError.badRequest('periodStart must be a valid date before periodEnd', 'INVALID_PERIOD');
  }
  if (data.locationId) assertLocationAccess(user, data.locationId);

  const groups =
    data.payeeType === SETTLEMENT_PAYEE_TYPES.DELIVERY_PARTNER
      ? await buildDeliveryPartnerGroups(periodStart, periodEnd)
      : await buildVendorOrStoreGroups(data.payeeType, periodStart, periodEnd);

  const created: InstanceType<typeof Settlement>[] = [];
  const skipped: { payeeId: string; reason: string }[] = [];

  for (const [payeeId, group] of groups) {
    // The ledger carries no locationId of its own — filtering/scoping happens
    // here instead, against the locationId resolved for this payee above
    // (same effect the old Order-query-time filter had).
    if (data.locationId && group.locationId !== data.locationId) continue;
    if (!hasLocationAccess(user, group.locationId)) continue;

    const overlapping = await Settlement.findOne({
      payeeType: data.payeeType,
      payeeId,
      periodStart: { $lt: periodEnd },
      periodEnd: { $gt: periodStart },
    });
    if (overlapping) {
      skipped.push({ payeeId, reason: 'A settlement already exists for this payee overlapping the requested period' });
      continue;
    }

    const netAmount = group.grossAmount - group.commissionAmount;
    const settlement = await Settlement.create({
      payeeType: data.payeeType,
      payeeId,
      locationId: group.locationId,
      periodStart,
      periodEnd,
      grossAmount: group.grossAmount,
      commissionAmount: group.commissionAmount,
      adjustments: 0,
      netAmount,
      status: SETTLEMENT_STATUS.PENDING,
      orderIds: group.orderIds,
    });
    created.push(settlement);
  }

  return { created, skipped };
}

function assertSettlementAccess(user: JwtPayload, settlement: ISettlement): void {
  if (user.userType === 'VENDOR') {
    if (settlement.payeeType !== SETTLEMENT_PAYEE_TYPES.VENDOR || settlement.payeeId.toString() !== user.userId) {
      throw ApiError.forbidden('You do not have access to this settlement', 'SETTLEMENT_FORBIDDEN');
    }
    return;
  }
  if (user.userType === 'DELIVERY_PARTNER') {
    if (settlement.payeeType !== SETTLEMENT_PAYEE_TYPES.DELIVERY_PARTNER || settlement.payeeId.toString() !== user.userId) {
      throw ApiError.forbidden('You do not have access to this settlement', 'SETTLEMENT_FORBIDDEN');
    }
    return;
  }
  assertLocationAccess(user, settlement.locationId.toString());
}

export function settlementListFilter(user: JwtPayload): Record<string, unknown> {
  if (user.userType === 'VENDOR') return { payeeType: SETTLEMENT_PAYEE_TYPES.VENDOR, payeeId: user.userId };
  if (user.userType === 'DELIVERY_PARTNER') return { payeeType: SETTLEMENT_PAYEE_TYPES.DELIVERY_PARTNER, payeeId: user.userId };
  return locationScopeFilter(user);
}

export async function listSettlements(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total] = await Promise.all([
    Settlement.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    Settlement.countDocuments(filter),
  ]);
  return { items, total };
}

async function findSettlementOrThrow(id: string) {
  const settlement = await Settlement.findById(id);
  if (!settlement) throw ApiError.notFound('Settlement not found', 'SETTLEMENT_NOT_FOUND');
  return settlement;
}

export async function getSettlementById(id: string, user: JwtPayload) {
  const settlement = await findSettlementOrThrow(id);
  assertSettlementAccess(user, settlement);
  return settlement;
}

export async function updateSettlementAdjustments(id: string, adjustments: number, user: JwtPayload) {
  const settlement = await findSettlementOrThrow(id);
  assertLocationAccess(user, settlement.locationId.toString());
  if (settlement.status !== SETTLEMENT_STATUS.PENDING) {
    throw ApiError.badRequest('Adjustments can only be edited while a settlement is PENDING', 'SETTLEMENT_NOT_PENDING');
  }
  settlement.adjustments = adjustments;
  settlement.netAmount = settlement.grossAmount - settlement.commissionAmount + adjustments;
  await settlement.save();
  return settlement;
}

export async function processSettlement(id: string, user: JwtPayload) {
  const settlement = await findSettlementOrThrow(id);
  assertLocationAccess(user, settlement.locationId.toString());
  if (settlement.status !== SETTLEMENT_STATUS.PENDING) {
    throw ApiError.badRequest(`Cannot process a settlement in status ${settlement.status}`, 'SETTLEMENT_NOT_PENDING');
  }
  settlement.status = SETTLEMENT_STATUS.PROCESSING;
  await settlement.save();
  return settlement;
}

export async function paySettlement(id: string, transactionReference: string, user: JwtPayload) {
  const settlement = await findSettlementOrThrow(id);
  assertLocationAccess(user, settlement.locationId.toString());
  if (settlement.status !== SETTLEMENT_STATUS.PROCESSING) {
    throw ApiError.badRequest(`Cannot mark paid a settlement in status ${settlement.status}`, 'SETTLEMENT_NOT_PROCESSING');
  }
  settlement.status = SETTLEMENT_STATUS.PAID;
  settlement.transactionReference = transactionReference;
  settlement.paidAt = new Date();
  await settlement.save();

  // Money actually leaving the platform to the payee. STORE settlements are
  // recorded under the same VENDOR_SETTLEMENT ledger type as VENDOR ones — the
  // TRANSACTION_TYPE enum (per the ledger's spec) doesn't define a separate
  // STORE_SETTLEMENT, so this is a documented judgment call rather than an
  // omission. Skipped for a zero/negative net (e.g. adjustments wiped it out
  // entirely) — there's no payout to record.
  if (settlement.netAmount > 0) {
    await ledgerService.recordTransaction({
      vendorId: settlement.payeeType === SETTLEMENT_PAYEE_TYPES.VENDOR ? settlement.payeeId.toString() : undefined,
      storeId: settlement.payeeType === SETTLEMENT_PAYEE_TYPES.STORE ? settlement.payeeId.toString() : undefined,
      deliveryPartnerId: settlement.payeeType === SETTLEMENT_PAYEE_TYPES.DELIVERY_PARTNER ? settlement.payeeId.toString() : undefined,
      type:
        settlement.payeeType === SETTLEMENT_PAYEE_TYPES.DELIVERY_PARTNER
          ? TRANSACTION_TYPE.DELIVERY_SETTLEMENT
          : TRANSACTION_TYPE.VENDOR_SETTLEMENT,
      amount: settlement.netAmount,
      direction: TRANSACTION_DIRECTION.DEBIT,
      metadata: { settlementId: settlement.id, transactionReference },
    });
  }

  // Store has no login of its own (see the established pattern elsewhere in
  // this codebase), so there's no account to notify — only VENDOR and
  // DELIVERY_PARTNER settlements have a real recipient.
  if (settlement.payeeType === SETTLEMENT_PAYEE_TYPES.VENDOR || settlement.payeeType === SETTLEMENT_PAYEE_TYPES.DELIVERY_PARTNER) {
    await notificationService.notify(
      settlement.payeeId.toString(),
      settlement.payeeType,
      NOTIFICATION_TYPES.SETTLEMENT_COMPLETED,
      'Settlement paid',
      `Your settlement of ${settlement.netAmount} for ${settlement.periodStart.toDateString()} - ${settlement.periodEnd.toDateString()} has been paid.`,
      { settlementId: settlement.id },
    );
  }

  return settlement;
}
