import { Vendor } from '../models/Vendor';
import { VendorDocument } from '../models/VendorDocument';
import { FoodProduct } from '../models/FoodProduct';
import { Location } from '../models/Location';
import { ApiError } from '../utils/ApiError';
import { hashPassword } from '../utils/password';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { assertLocationAccess } from '../middleware/rbac.middleware';
import { VENDOR_STATUS, APPROVAL_STATUS } from '../constants/enums';

export async function listVendors(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total] = await Promise.all([
    Vendor.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    Vendor.countDocuments(filter),
  ]);
  return { items, total };
}

export async function createVendor(data: Record<string, unknown>) {
  const locationExists = await Location.exists({ _id: data.locationId });
  if (!locationExists) throw ApiError.notFound('Location not found', 'LOCATION_NOT_FOUND');

  const password = await hashPassword(data.password as string);
  return Vendor.create({ ...data, password, status: VENDOR_STATUS.ACTIVE, approvalStatus: APPROVAL_STATUS.PENDING });
}

async function findVendorOrThrow(id: string) {
  const vendor = await Vendor.findById(id);
  if (!vendor) throw ApiError.notFound('Vendor not found', 'VENDOR_NOT_FOUND');
  return vendor;
}

// `locationId` is a required field on the schema, but a small number of
// legacy records predate that constraint and have it missing — guard here so
// those surface as a clear 422 instead of crashing every admin vendor
// endpoint with an unhandled `Cannot read properties of undefined` 500.
function requireVendorLocationId(vendor: { locationId?: unknown }): string {
  if (!vendor.locationId) {
    throw ApiError.unprocessable(
      'This vendor record has no location assigned and cannot be managed until one is set',
      'VENDOR_MISSING_LOCATION',
    );
  }
  return (vendor.locationId as { toString(): string }).toString();
}

// A vendor may view/update their own record (e.g. the open/closed toggle and
// their own profile in the Vendor App); anyone else goes through ordinary
// admin location scoping.
function assertVendorAccess(user: JwtPayload, vendor: { id?: string; locationId?: unknown }): void {
  if (user.userType === 'VENDOR') {
    if (user.userId !== vendor.id) throw ApiError.forbidden('You do not have access to this resource', 'OWNER_FORBIDDEN');
    return;
  }
  assertLocationAccess(user, requireVendorLocationId(vendor));
}

export async function getVendorById(id: string, user: JwtPayload) {
  const vendor = await findVendorOrThrow(id);
  assertVendorAccess(user, vendor);
  return vendor;
}

export async function updateVendor(id: string, data: Record<string, unknown>, user: JwtPayload) {
  const vendor = await findVendorOrThrow(id);
  assertVendorAccess(user, vendor);

  // A vendor may edit their own profile, but never reassign which location
  // they belong to — that stays an admin-only action.
  const payload = user.userType === 'VENDOR' ? { ...data } : data;
  if (user.userType === 'VENDOR') delete payload.locationId;

  Object.assign(vendor, payload);
  await vendor.save();
  return vendor;
}

export async function deleteVendor(id: string, user: JwtPayload) {
  const vendor = await findVendorOrThrow(id);
  assertLocationAccess(user, requireVendorLocationId(vendor));
  await vendor.deleteOne();
}

export async function updateVendorStatus(id: string, status: string, user: JwtPayload) {
  return updateVendor(id, { status }, user);
}

export async function approveVendor(id: string, user: JwtPayload) {
  const vendor = await findVendorOrThrow(id);
  assertLocationAccess(user, requireVendorLocationId(vendor));
  vendor.approvalStatus = APPROVAL_STATUS.APPROVED;
  vendor.status = VENDOR_STATUS.ACTIVE;
  await vendor.save();
  return vendor;
}

export async function rejectVendor(id: string, reason: string, user: JwtPayload) {
  const vendor = await findVendorOrThrow(id);
  assertLocationAccess(user, requireVendorLocationId(vendor));
  vendor.approvalStatus = APPROVAL_STATUS.REJECTED;
  vendor.status = VENDOR_STATUS.INACTIVE;
  await vendor.save();
  return { vendor, reason };
}

export async function suspendVendor(id: string, user: JwtPayload) {
  return updateVendorStatus(id, VENDOR_STATUS.SUSPENDED, user);
}

export async function activateVendor(id: string, user: JwtPayload) {
  return updateVendorStatus(id, VENDOR_STATUS.ACTIVE, user);
}

export async function getVendorDashboard(id: string, user: JwtPayload) {
  const vendor = await findVendorOrThrow(id);
  assertLocationAccess(user, requireVendorLocationId(vendor));

  const [productCount, availableProductCount] = await Promise.all([
    FoodProduct.countDocuments({ vendorId: id }),
    FoodProduct.countDocuments({ vendorId: id, isAvailable: true }),
  ]);

  return {
    productCount,
    availableProductCount,
    rating: vendor.rating,
    ratingCount: vendor.ratingCount,
    isOpen: vendor.isOpen,
    status: vendor.status,
    approvalStatus: vendor.approvalStatus,
  };
}

export async function getVendorProducts(id: string, user: JwtPayload, pagination: PaginationParams) {
  const vendor = await findVendorOrThrow(id);
  assertLocationAccess(user, requireVendorLocationId(vendor));

  const [items, total] = await Promise.all([
    FoodProduct.find({ vendorId: id }).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    FoodProduct.countDocuments({ vendorId: id }),
  ]);
  return { items, total };
}

export async function listVendorDocuments(vendorId: string, user: JwtPayload) {
  const vendor = await findVendorOrThrow(vendorId);
  assertLocationAccess(user, requireVendorLocationId(vendor));
  return VendorDocument.find({ vendorId }).sort({ createdAt: -1 });
}

export async function addVendorDocument(vendorId: string, data: Record<string, unknown>, user: JwtPayload) {
  const vendor = await findVendorOrThrow(vendorId);
  assertLocationAccess(user, requireVendorLocationId(vendor));
  return VendorDocument.create({ ...data, vendorId });
}

export async function updateVendorDocument(
  vendorId: string,
  documentId: string,
  data: Record<string, unknown>,
  user: JwtPayload,
) {
  const vendor = await findVendorOrThrow(vendorId);
  assertLocationAccess(user, requireVendorLocationId(vendor));

  const document = await VendorDocument.findOneAndUpdate({ _id: documentId, vendorId }, data, { new: true });
  if (!document) throw ApiError.notFound('Vendor document not found', 'VENDOR_DOCUMENT_NOT_FOUND');
  return document;
}

export async function deleteVendorDocument(vendorId: string, documentId: string, user: JwtPayload) {
  const vendor = await findVendorOrThrow(vendorId);
  assertLocationAccess(user, requireVendorLocationId(vendor));

  const document = await VendorDocument.findOneAndDelete({ _id: documentId, vendorId });
  if (!document) throw ApiError.notFound('Vendor document not found', 'VENDOR_DOCUMENT_NOT_FOUND');
}
