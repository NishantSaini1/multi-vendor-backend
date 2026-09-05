import { Settlement, ISettlement, SETTLEMENT_PAYEE_TYPES } from '../models/Settlement';
import { Order } from '../models/Order';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { assertLocationAccess, locationScopeFilter } from '../middleware/rbac.middleware';
import { SETTLEMENT_STATUS } from '../constants/paymentStatus';
import { DISCOUNT_TYPES, NOTIFICATION_TYPES } from '../constants/enums';
import * as commissionService from './commission.service';
import * as notificationService from './notification.service';

interface LeanOrderForSettlement {
  _id: unknown;
  locationId: { toString(): string };
  vendorId?: { toString(): string };
  storeId?: { toString(): string };
  deliveryPartnerId?: { toString(): string };
  businessType: string;
  subtotal: number;
  discount: number;
  deliveryFee: number;
}

const PAYEE_FIELD: Record<string, 'vendorId' | 'storeId' | 'deliveryPartnerId'> = {
  [SETTLEMENT_PAYEE_TYPES.VENDOR]: 'vendorId',
  [SETTLEMENT_PAYEE_TYPES.STORE]: 'storeId',
  [SETTLEMENT_PAYEE_TYPES.DELIVERY_PARTNER]: 'deliveryPartnerId',
};

// What counts as a payee's "gross" earnings for a settled order — a
// documented judgment call (the spec doesn't pin down the split): vendors
// and stores earn the item revenue (subtotal - discount), not the delivery
// fee (that's the delivery partner's) or tax/platform fee (pass-through /
// platform's own). Delivery partners earn the order's delivery fee outright.
function grossForOrder(payeeType: string, order: LeanOrderForSettlement): number {
  return payeeType === SETTLEMENT_PAYEE_TYPES.DELIVERY_PARTNER ? order.deliveryFee : order.subtotal - order.discount;
}

// Delivery partners have no Commission entity of their own (COMMISSION_LEVELS
// has no DELIVERY_PARTNER level) — under this scaffold they keep 100% of the
// delivery fees they earn; a platform cut on deliveries, if ever needed, is
// a separate future decision rather than something to invent here.
async function commissionForGroup(
  payeeType: string,
  payeeId: string,
  group: LeanOrderForSettlement[],
): Promise<number> {
  if (payeeType === SETTLEMENT_PAYEE_TYPES.DELIVERY_PARTNER) return 0;

  const grossAmount = group.reduce((sum, o) => sum + grossForOrder(payeeType, o), 0);
  const first = group[0];
  const commission = await commissionService.resolveCommission({
    locationId: first.locationId.toString(),
    vendorId: payeeType === SETTLEMENT_PAYEE_TYPES.VENDOR ? payeeId : undefined,
    storeId: payeeType === SETTLEMENT_PAYEE_TYPES.STORE ? payeeId : undefined,
    businessType: first.businessType,
  });
  if (!commission) return 0;

  return commission.type === DISCOUNT_TYPES.PERCENTAGE ? grossAmount * (commission.value / 100) : commission.value * group.length;
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

  const payeeField = PAYEE_FIELD[data.payeeType];

  const orderFilter: Record<string, unknown> = {
    status: 'DELIVERED',
    // Proxy for "when the order reached DELIVERED" — Order doesn't track a
    // dedicated deliveredAt timestamp, and updatedAt reflects the last status
    // transition, which for a DELIVERED order is that delivery.
    updatedAt: { $gte: periodStart, $lt: periodEnd },
    [payeeField]: { $exists: true, $ne: null },
    ...locationScopeFilter(user),
  };
  if (data.locationId) {
    assertLocationAccess(user, data.locationId);
    orderFilter.locationId = data.locationId;
  }

  const orders = (await Order.find(orderFilter)
    .select('locationId vendorId storeId deliveryPartnerId businessType subtotal discount deliveryFee')
    .lean()) as unknown as LeanOrderForSettlement[];

  const groups = new Map<string, LeanOrderForSettlement[]>();
  for (const order of orders) {
    const payeeId = order[payeeField]?.toString();
    if (!payeeId) continue;
    const group = groups.get(payeeId);
    if (group) group.push(order);
    else groups.set(payeeId, [order]);
  }

  const created: InstanceType<typeof Settlement>[] = [];
  const skipped: { payeeId: string; reason: string }[] = [];

  for (const [payeeId, group] of groups) {
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

    const grossAmount = group.reduce((sum, o) => sum + grossForOrder(data.payeeType, o), 0);
    const commissionAmount = await commissionForGroup(data.payeeType, payeeId, group);
    const netAmount = grossAmount - commissionAmount;

    const settlement = await Settlement.create({
      payeeType: data.payeeType,
      payeeId,
      locationId: group[0].locationId,
      periodStart,
      periodEnd,
      grossAmount,
      commissionAmount,
      adjustments: 0,
      netAmount,
      status: SETTLEMENT_STATUS.PENDING,
      orderIds: group.map((o) => o._id),
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
