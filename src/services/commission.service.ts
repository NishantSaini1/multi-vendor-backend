import { Commission, ICommission } from '../models/Commission';
import { Vendor } from '../models/Vendor';
import { Store } from '../models/Store';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { assertLocationAccess, locationScopeFilter } from '../middleware/rbac.middleware';
import { ADMIN_ROLES } from '../constants/roles';
import { COMMISSION_LEVELS, GENERIC_STATUS } from '../constants/enums';

// Resolves the locationId a Commission rule is scoped to, for access-control
// purposes — GLOBAL/LOCATION rules carry it directly; VENDOR/STORE rules
// inherit it from the vendor/store they target (a vendor's location never
// changes independently of the vendor itself, so this is a stable lookup).
async function scopeLocationId(data: { level: string; locationId?: string; vendorId?: string; storeId?: string }): Promise<string | undefined> {
  if (data.level === COMMISSION_LEVELS.VENDOR) {
    const vendor = await Vendor.findById(data.vendorId);
    if (!vendor) throw ApiError.notFound('Vendor not found', 'VENDOR_NOT_FOUND');
    return vendor.locationId.toString();
  }
  if (data.level === COMMISSION_LEVELS.STORE) {
    const store = await Store.findById(data.storeId);
    if (!store) throw ApiError.notFound('Store not found', 'STORE_NOT_FOUND');
    return store.locationId.toString();
  }
  return data.locationId;
}

function assertCommissionAccess(user: JwtPayload, locationId: string | undefined): void {
  if (!locationId) {
    if (user.role !== ADMIN_ROLES.SUPER_ADMIN) {
      throw ApiError.forbidden('Only a super admin can manage a GLOBAL commission rule', 'GLOBAL_COMMISSION_FORBIDDEN');
    }
    return;
  }
  assertLocationAccess(user, locationId);
}

export function commissionListFilter(user: JwtPayload): Record<string, unknown> {
  const scope = locationScopeFilter(user);
  if (!scope.locationId) return {};
  // Location-scoped admins see LOCATION-level rules for their own
  // location(s) plus GLOBAL rules (locationId: null) — never another
  // location's rules, and VENDOR/STORE-level rules are filtered by the
  // controller passing vendorId/storeId explicitly instead (this filter
  // only constrains the locationId field itself).
  return { $or: [{ locationId: null }, scope] };
}

export async function listCommissions(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total] = await Promise.all([
    Commission.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    Commission.countDocuments(filter),
  ]);
  return { items, total };
}

export async function createCommission(data: Record<string, unknown>, user: JwtPayload) {
  const locationId = await scopeLocationId(data as { level: string; locationId?: string; vendorId?: string; storeId?: string });
  assertCommissionAccess(user, locationId);
  return Commission.create(data);
}

async function findCommissionOrThrow(id: string) {
  const commission = await Commission.findById(id);
  if (!commission) throw ApiError.notFound('Commission rule not found', 'COMMISSION_NOT_FOUND');
  return commission;
}

async function assertAccessToExisting(commission: ICommission, user: JwtPayload) {
  const locationId = await scopeLocationId({
    level: commission.level,
    locationId: commission.locationId?.toString(),
    vendorId: commission.vendorId?.toString(),
    storeId: commission.storeId?.toString(),
  });
  assertCommissionAccess(user, locationId);
}

export async function getCommissionById(id: string, user: JwtPayload) {
  const commission = await findCommissionOrThrow(id);
  await assertAccessToExisting(commission, user);
  return commission;
}

export async function updateCommission(id: string, data: Record<string, unknown>, user: JwtPayload) {
  const commission = await findCommissionOrThrow(id);
  await assertAccessToExisting(commission, user);
  Object.assign(commission, data);
  await commission.save();
  return commission;
}

export async function deleteCommission(id: string, user: JwtPayload) {
  const commission = await findCommissionOrThrow(id);
  await assertAccessToExisting(commission, user);
  await commission.deleteOne();
}

export async function updateCommissionStatus(id: string, status: string, user: JwtPayload) {
  return updateCommission(id, { status }, user);
}

// Used by settlement generation to find the applicable commission for an
// order — tried most-specific first (STORE/VENDOR, whichever the order
// actually has) down to LOCATION, then GLOBAL as the platform-wide default.
// At each level, a rule scoped to the order's exact businessType outranks a
// level-wide rule left unscoped (sorting descending on businessType puts a
// present string value ahead of a missing field, since Mongo treats a
// missing field as sorting below any BSON value in ascending order).
// Returns null (no commission configured — vendor/store keeps 100%) rather
// than throwing, matching the project's existing "default to 0 when no fee
// config exists" pattern (see order.service's packagingFee/platformFee).
export async function resolveCommission(params: {
  locationId: string;
  vendorId?: string;
  storeId?: string;
  businessType: string;
}): Promise<{ type: string; value: number } | null> {
  const levelsToTry: { level: string; match: Record<string, unknown> }[] = [];
  if (params.storeId) levelsToTry.push({ level: COMMISSION_LEVELS.STORE, match: { storeId: params.storeId } });
  if (params.vendorId) levelsToTry.push({ level: COMMISSION_LEVELS.VENDOR, match: { vendorId: params.vendorId } });
  levelsToTry.push({ level: COMMISSION_LEVELS.LOCATION, match: { locationId: params.locationId } });
  levelsToTry.push({ level: COMMISSION_LEVELS.GLOBAL, match: {} });

  for (const { level, match } of levelsToTry) {
    const commission = await Commission.findOne({
      level,
      status: GENERIC_STATUS.ACTIVE,
      ...match,
      $or: [{ businessType: params.businessType }, { businessType: { $exists: false } }],
    }).sort({ businessType: -1 });
    if (commission) return { type: commission.type, value: commission.value };
  }
  return null;
}
