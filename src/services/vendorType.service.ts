import { VendorType } from '../models/VendorType';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { GENERIC_STATUS } from '../constants/enums';
import { JwtPayload } from '../utils/jwt';

// A flat global taxonomy, not location/vendor-scoped — every actor sees the
// same list; CUSTOMER (browsing filters) and VENDOR (signup/profile type
// picker) only ever see ACTIVE ones.
export function vendorTypeListFilter(user: JwtPayload): Record<string, unknown> {
  if (user.userType === 'CUSTOMER' || user.userType === 'VENDOR') return { status: GENERIC_STATUS.ACTIVE };
  return {};
}

export async function listVendorTypes(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total] = await Promise.all([
    VendorType.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    VendorType.countDocuments(filter),
  ]);
  return { items, total };
}

export async function createVendorType(data: Record<string, unknown>) {
  return VendorType.create(data);
}

async function findVendorTypeOrThrow(id: string) {
  const vendorType = await VendorType.findById(id);
  if (!vendorType) throw ApiError.notFound('Vendor type not found', 'VENDOR_TYPE_NOT_FOUND');
  return vendorType;
}

export async function getVendorTypeById(id: string, user: JwtPayload) {
  const vendorType = await findVendorTypeOrThrow(id);
  if ((user.userType === 'CUSTOMER' || user.userType === 'VENDOR') && vendorType.status !== GENERIC_STATUS.ACTIVE) {
    throw ApiError.notFound('Vendor type not found', 'VENDOR_TYPE_NOT_FOUND');
  }
  return vendorType;
}

export async function updateVendorType(id: string, data: Record<string, unknown>) {
  const vendorType = await findVendorTypeOrThrow(id);
  Object.assign(vendorType, data);
  await vendorType.save();
  return vendorType;
}

export async function deleteVendorType(id: string) {
  const vendorType = await findVendorTypeOrThrow(id);
  await vendorType.deleteOne();
}

export async function updateVendorTypeStatus(id: string, status: string) {
  return updateVendorType(id, { status });
}
