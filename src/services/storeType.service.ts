import { StoreType } from '../models/StoreType';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { GENERIC_STATUS } from '../constants/enums';
import { JwtPayload } from '../utils/jwt';

// A flat global taxonomy, not location/vendor/store-scoped — every actor sees
// the same list; CUSTOMER (and STORE, browsing type options) only ever see
// ACTIVE ones.
export function storeTypeListFilter(user: JwtPayload): Record<string, unknown> {
  if (user.userType === 'CUSTOMER' || user.userType === 'STORE') return { status: GENERIC_STATUS.ACTIVE };
  return {};
}

export async function listStoreTypes(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total] = await Promise.all([
    StoreType.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    StoreType.countDocuments(filter),
  ]);
  return { items, total };
}

export async function createStoreType(data: Record<string, unknown>) {
  return StoreType.create(data);
}

async function findStoreTypeOrThrow(id: string) {
  const storeType = await StoreType.findById(id);
  if (!storeType) throw ApiError.notFound('Store type not found', 'STORE_TYPE_NOT_FOUND');
  return storeType;
}

export async function getStoreTypeById(id: string, user: JwtPayload) {
  const storeType = await findStoreTypeOrThrow(id);
  if ((user.userType === 'CUSTOMER' || user.userType === 'STORE') && storeType.status !== GENERIC_STATUS.ACTIVE) {
    throw ApiError.notFound('Store type not found', 'STORE_TYPE_NOT_FOUND');
  }
  return storeType;
}

export async function updateStoreType(id: string, data: Record<string, unknown>) {
  const storeType = await findStoreTypeOrThrow(id);
  Object.assign(storeType, data);
  await storeType.save();
  return storeType;
}

export async function deleteStoreType(id: string) {
  const storeType = await findStoreTypeOrThrow(id);
  await storeType.deleteOne();
}

export async function updateStoreTypeStatus(id: string, status: string) {
  return updateStoreType(id, { status });
}
