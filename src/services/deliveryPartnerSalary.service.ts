import { DeliveryPartnerSalaryConfig } from '../models/DeliveryPartnerSalaryConfig';
import { DeliveryPartnerSalaryRecord } from '../models/DeliveryPartnerSalaryRecord';
import { DeliveryPartner } from '../models/DeliveryPartner';
import { Delivery } from '../models/Delivery';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { assertLocationAccess, hasLocationAccess } from '../middleware/rbac.middleware';
import { SALARY_RECORD_STATUS, TRANSACTION_TYPE, TRANSACTION_DIRECTION } from '../constants/enums';
import { DELIVERY_STATUS } from '../constants/deliveryStatus';
import * as ledgerService from './ledger.service';

const round2 = (n: number) => Math.round(n * 100) / 100;

// ─── Salary Config ────────────────────────────────────────────────────────────

export async function upsertSalaryConfig(
  partnerId: string,
  data: { monthlySalary: number; hasOwnVehicle?: boolean; perKmRate?: number; notes?: string },
  user: JwtPayload,
) {
  const partner = await DeliveryPartner.findById(partnerId).select('locationId');
  if (!partner) throw ApiError.notFound('Delivery partner not found', 'PARTNER_NOT_FOUND');
  assertLocationAccess(user, partner.locationId.toString());

  const hasOwnVehicle = data.hasOwnVehicle ?? false;
  const perKmRate = hasOwnVehicle ? (data.perKmRate ?? 0) : 0;

  const config = await DeliveryPartnerSalaryConfig.findOneAndUpdate(
    { deliveryPartnerId: partnerId },
    {
      deliveryPartnerId: partnerId,
      monthlySalary: data.monthlySalary,
      hasOwnVehicle,
      perKmRate,
      notes: data.notes,
      updatedBy: user.userId,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return config;
}

export async function getSalaryConfig(partnerId: string, user: JwtPayload) {
  const partner = await DeliveryPartner.findById(partnerId).select('locationId');
  if (!partner) throw ApiError.notFound('Delivery partner not found', 'PARTNER_NOT_FOUND');
  assertLocationAccess(user, partner.locationId.toString());

  const config = await DeliveryPartnerSalaryConfig.findOne({ deliveryPartnerId: partnerId });
  if (!config) throw ApiError.notFound('Salary config not found for this partner', 'SALARY_CONFIG_NOT_FOUND');
  return config;
}

export async function deleteSalaryConfig(partnerId: string, user: JwtPayload) {
  const partner = await DeliveryPartner.findById(partnerId).select('locationId');
  if (!partner) throw ApiError.notFound('Delivery partner not found', 'PARTNER_NOT_FOUND');
  assertLocationAccess(user, partner.locationId.toString());

  const config = await DeliveryPartnerSalaryConfig.findOneAndDelete({ deliveryPartnerId: partnerId });
  if (!config) throw ApiError.notFound('Salary config not found for this partner', 'SALARY_CONFIG_NOT_FOUND');
  return config;
}

export async function listSalaryConfigs(
  filter: { locationId?: string; partnerId?: string },
  pagination: PaginationParams,
  user: JwtPayload,
) {
  // Build a list of eligible deliveryPartnerIds scoped to accessible locations.
  const partnerFilter: Record<string, unknown> = {};
  if (filter.locationId) {
    assertLocationAccess(user, filter.locationId);
    partnerFilter.locationId = filter.locationId;
  }
  if (filter.partnerId) partnerFilter._id = filter.partnerId;

  const partners = await DeliveryPartner.find(partnerFilter).select('_id locationId');
  const accessibleIds = partners
    .filter((p) => hasLocationAccess(user, p.locationId.toString()))
    .map((p) => p._id);

  const configFilter = { deliveryPartnerId: { $in: accessibleIds } };
  const [items, total] = await Promise.all([
    DeliveryPartnerSalaryConfig.find(configFilter)
      .populate('deliveryPartnerId', 'name phone locationId')
      .sort(pagination.sort)
      .skip(pagination.skip)
      .limit(pagination.limit),
    DeliveryPartnerSalaryConfig.countDocuments(configFilter),
  ]);
  return { items, total };
}

// ─── Salary Records ───────────────────────────────────────────────────────────

// Build a period covering the entire calendar month (UTC).
function monthBounds(year: number, month: number) {
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 1)); // exclusive
  return { periodStart, periodEnd };
}

// Compute and persist a salary record for one partner/month. Idempotent —
// throws ALREADY_EXISTS if a record already exists for that partner+month.
export async function generateSalaryRecord(
  partnerId: string,
  year: number,
  month: number,
  user: JwtPayload,
): Promise<InstanceType<typeof DeliveryPartnerSalaryRecord>> {
  const partner = await DeliveryPartner.findById(partnerId).select('locationId');
  if (!partner) throw ApiError.notFound('Delivery partner not found', 'PARTNER_NOT_FOUND');
  assertLocationAccess(user, partner.locationId.toString());

  const config = await DeliveryPartnerSalaryConfig.findOne({ deliveryPartnerId: partnerId });
  if (!config) {
    throw ApiError.badRequest('No salary config found for this partner', 'SALARY_CONFIG_NOT_FOUND');
  }

  const existing = await DeliveryPartnerSalaryRecord.findOne({ deliveryPartnerId: partnerId, year, month });
  if (existing) {
    throw ApiError.conflict(`Salary record already exists for ${year}-${String(month).padStart(2, '0')}`, 'SALARY_RECORD_EXISTS');
  }

  const { periodStart, periodEnd } = monthBounds(year, month);

  const deliveries = await Delivery.find({
    deliveryPartnerId: partnerId,
    status: DELIVERY_STATUS.DELIVERED,
    deliveredAt: { $gte: periodStart, $lt: periodEnd },
  }).select('distance deliveryFee orderId');

  const totalDistance = round2(deliveries.reduce((sum, d) => sum + (d.distance ?? 0), 0));
  const deliveryCount = deliveries.length;
  const customerDeliveryChargeTotal = round2(deliveries.reduce((sum, d) => sum + (d.deliveryFee ?? 0), 0));

  const vehicleAllowance = config.hasOwnVehicle ? round2(totalDistance * config.perKmRate) : 0;
  const totalPayout = round2(config.monthlySalary + vehicleAllowance);

  const record = await DeliveryPartnerSalaryRecord.create({
    deliveryPartnerId: partnerId,
    locationId: partner.locationId,
    year,
    month,
    baseSalary: config.monthlySalary,
    hasOwnVehicle: config.hasOwnVehicle,
    perKmRate: config.perKmRate,
    totalDistance,
    deliveryCount,
    vehicleAllowance,
    totalPayout,
    customerDeliveryChargeTotal,
    adminEarningsFromDelivery: customerDeliveryChargeTotal,
    status: SALARY_RECORD_STATUS.PENDING,
    orderIds: deliveries.map((d) => d.orderId),
  });

  return record;
}

// Generate records for every configured partner in a location (or platform-wide
// if locationId is omitted). Skips partners who already have a record for that
// month and returns separate created/skipped lists.
export async function generateBulkSalaryRecords(
  data: { year: number; month: number; locationId?: string },
  user: JwtPayload,
) {
  if (data.locationId) assertLocationAccess(user, data.locationId);

  const partnerFilter: Record<string, unknown> = {};
  if (data.locationId) partnerFilter.locationId = data.locationId;
  const partners = await DeliveryPartner.find(partnerFilter).select('_id locationId');

  const configs = await DeliveryPartnerSalaryConfig.find({
    deliveryPartnerId: { $in: partners.map((p) => p._id) },
  }).select('deliveryPartnerId');

  const configuredIds = new Set(configs.map((c) => c.deliveryPartnerId.toString()));
  const eligible = partners.filter(
    (p) => configuredIds.has(p._id.toString()) && hasLocationAccess(user, p.locationId.toString()),
  );

  const created: InstanceType<typeof DeliveryPartnerSalaryRecord>[] = [];
  const skipped: { partnerId: string; reason: string }[] = [];

  for (const partner of eligible) {
    const existing = await DeliveryPartnerSalaryRecord.findOne({
      deliveryPartnerId: partner._id,
      year: data.year,
      month: data.month,
    });
    if (existing) {
      skipped.push({ partnerId: partner._id.toString(), reason: 'Record already exists for this month' });
      continue;
    }
    try {
      const record = await generateSalaryRecord(partner._id.toString(), data.year, data.month, user);
      created.push(record);
    } catch {
      skipped.push({ partnerId: partner._id.toString(), reason: 'Failed to generate record' });
    }
  }

  return { created, skipped };
}

export async function listSalaryRecords(
  filter: { locationId?: string; deliveryPartnerId?: string; year?: number; month?: number; status?: string },
  pagination: PaginationParams,
  user: JwtPayload,
) {
  const query: Record<string, unknown> = {};

  // Delivery partners can only see their own records; admins are location-scoped.
  if (user.userType === 'DELIVERY_PARTNER') {
    query.deliveryPartnerId = user.userId;
  } else {
    if (filter.locationId) {
      assertLocationAccess(user, filter.locationId);
      query.locationId = filter.locationId;
    }
    if (filter.deliveryPartnerId) query.deliveryPartnerId = filter.deliveryPartnerId;
  }

  if (filter.year !== undefined) query.year = filter.year;
  if (filter.month !== undefined) query.month = filter.month;
  if (filter.status) query.status = filter.status;

  const [items, total] = await Promise.all([
    DeliveryPartnerSalaryRecord.find(query)
      .populate('deliveryPartnerId', 'name phone')
      .sort(pagination.sort)
      .skip(pagination.skip)
      .limit(pagination.limit),
    DeliveryPartnerSalaryRecord.countDocuments(query),
  ]);
  return { items, total };
}

export async function getSalaryRecordById(id: string, user: JwtPayload) {
  const record = await DeliveryPartnerSalaryRecord.findById(id).populate('deliveryPartnerId', 'name phone');
  if (!record) throw ApiError.notFound('Salary record not found', 'SALARY_RECORD_NOT_FOUND');
  if (user.userType === 'DELIVERY_PARTNER') {
    if (record.deliveryPartnerId.toString() !== user.userId) throw ApiError.forbidden('Access denied', 'FORBIDDEN');
    return record;
  }
  assertLocationAccess(user, record.locationId.toString());
  return record;
}

// Mark a salary record as paid and write a ledger entry for the payout.
export async function markSalaryPaid(id: string, transactionReference: string, user: JwtPayload) {
  const record = await DeliveryPartnerSalaryRecord.findById(id);
  if (!record) throw ApiError.notFound('Salary record not found', 'SALARY_RECORD_NOT_FOUND');
  assertLocationAccess(user, record.locationId.toString());

  if (record.status !== SALARY_RECORD_STATUS.PENDING) {
    throw ApiError.badRequest(`Cannot mark paid a record in status ${record.status}`, 'SALARY_RECORD_NOT_PENDING');
  }

  record.status = SALARY_RECORD_STATUS.PAID;
  record.paidAt = new Date();
  record.transactionReference = transactionReference;
  await record.save();

  if (record.totalPayout > 0) {
    await ledgerService.recordTransaction({
      deliveryPartnerId: record.deliveryPartnerId.toString(),
      type: TRANSACTION_TYPE.DELIVERY_SALARY_PAYOUT,
      amount: record.totalPayout,
      direction: TRANSACTION_DIRECTION.DEBIT,
      metadata: {
        salaryRecordId: record.id,
        year: record.year,
        month: record.month,
        baseSalary: record.baseSalary,
        vehicleAllowance: record.vehicleAllowance,
        transactionReference,
      },
    });
  }

  return record;
}
