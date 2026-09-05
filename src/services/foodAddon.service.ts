import { FoodAddon } from '../models/FoodAddon';
import { FoodProduct } from '../models/FoodProduct';
import { Vendor } from '../models/Vendor';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { assertOwnerOrLocationAccess, locationScopeFilter } from '../middleware/rbac.middleware';

async function resolveVendor(data: { vendorId?: string }, user: JwtPayload) {
  if (user.userType === 'VENDOR') {
    const vendor = await Vendor.findById(user.userId);
    if (!vendor) throw ApiError.notFound('Vendor not found', 'VENDOR_NOT_FOUND');
    return vendor;
  }

  if (!data.vendorId) throw ApiError.badRequest('vendorId is required', 'VENDOR_ID_REQUIRED');
  const vendor = await Vendor.findById(data.vendorId);
  if (!vendor) throw ApiError.notFound('Vendor not found', 'VENDOR_NOT_FOUND');
  assertOwnerOrLocationAccess(user, vendor.id, vendor.locationId.toString());
  return vendor;
}

async function assertProductsBelongToVendor(productIds: string[], vendorId: string): Promise<void> {
  if (productIds.length === 0) return;
  const count = await FoodProduct.countDocuments({ _id: { $in: productIds }, vendorId });
  if (count !== productIds.length) {
    throw ApiError.badRequest('All productIds must belong to the same vendor', 'PRODUCT_VENDOR_MISMATCH');
  }
}

export async function listFoodAddons(
  query: { vendorId?: string; productId?: string },
  pagination: PaginationParams,
  user: JwtPayload,
) {
  const filter: Record<string, unknown> = {};

  if (user.userType === 'VENDOR') {
    filter.vendorId = user.userId;
  } else {
    const scope = locationScopeFilter(user);
    if (Object.keys(scope).length > 0) {
      const vendorIds = await Vendor.find(scope).distinct('_id');
      filter.vendorId = { $in: vendorIds };
    }
    if (query.vendorId) filter.vendorId = query.vendorId;
  }

  if (query.productId) filter.productIds = query.productId;

  const [items, total] = await Promise.all([
    FoodAddon.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    FoodAddon.countDocuments(filter),
  ]);
  return { items, total };
}

export async function createFoodAddon(data: Record<string, unknown>, user: JwtPayload) {
  const vendor = await resolveVendor({ vendorId: data.vendorId as string | undefined }, user);
  await assertProductsBelongToVendor((data.productIds as string[]) ?? [], vendor.id);
  return FoodAddon.create({ ...data, vendorId: vendor.id });
}

async function findAddonOrThrow(id: string) {
  const addon = await FoodAddon.findById(id);
  if (!addon) throw ApiError.notFound('Food addon not found', 'FOOD_ADDON_NOT_FOUND');
  return addon;
}

async function assertAddonAccess(addon: { vendorId: { toString(): string } }, user: JwtPayload) {
  const vendor = await Vendor.findById(addon.vendorId);
  if (!vendor) throw ApiError.notFound('Vendor not found', 'VENDOR_NOT_FOUND');
  assertOwnerOrLocationAccess(user, vendor.id, vendor.locationId.toString());
  return vendor;
}

export async function getFoodAddonById(id: string, user: JwtPayload) {
  const addon = await findAddonOrThrow(id);
  await assertAddonAccess(addon, user);
  return addon;
}

export async function updateFoodAddon(id: string, data: Record<string, unknown>, user: JwtPayload) {
  const addon = await findAddonOrThrow(id);
  const vendor = await assertAddonAccess(addon, user);

  if (data.productIds) {
    await assertProductsBelongToVendor(data.productIds as string[], vendor.id);
  }

  Object.assign(addon, data);
  await addon.save();
  return addon;
}

export async function deleteFoodAddon(id: string, user: JwtPayload) {
  const addon = await findAddonOrThrow(id);
  await assertAddonAccess(addon, user);
  await addon.deleteOne();
}
