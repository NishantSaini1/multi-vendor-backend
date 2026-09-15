import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import { locationScopeFilter } from '../middleware/rbac.middleware';
import { VENDOR_STATUS, APPROVAL_STATUS, GENERIC_STATUS, VENDOR_FOOD_ITEM_AVAILABILITY } from '../constants/enums';
import * as vendorService from '../services/vendor.service';
import { IVendor } from '../models/Vendor';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

// The Vendor document carries operator PII (owner name, phone, email) and tax
// IDs (GST/FSSAI/PAN) that the Admin Panel and Vendor App need but a customer
// browsing restaurants never should see — trim the response down to the
// public "restaurant card / restaurant detail" fields for CUSTOMER callers.
function toCustomerVendorView(vendor: IVendor) {
  return {
    id: vendor._id,
    locationId: vendor.locationId,
    restaurantName: vendor.restaurantName,
    description: vendor.description,
    logo: vendor.logo,
    coverImage: vendor.coverImage,
    address: vendor.address,
    latitude: vendor.latitude,
    longitude: vendor.longitude,
    serviceRadius: vendor.serviceRadius,
    vendorTypeIds: vendor.vendorTypeIds,
    rating: vendor.rating,
    ratingCount: vendor.ratingCount,
    status: vendor.status,
    isOpen: vendor.isOpen,
    temporaryClosure: vendor.temporaryClosure,
    createdAt: vendor.createdAt,
  };
}

function serializeForUser(vendor: IVendor, userType: string) {
  return userType === 'CUSTOMER' ? toCustomerVendorView(vendor) : vendor;
}

export const list = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req, { restaurantName: 1 });
  const isCustomer = user.userType === 'CUSTOMER';

  const filter: Record<string, unknown> = { ...locationScopeFilter(user) };
  if (req.query.locationId) filter.locationId = req.query.locationId;
  if (isCustomer) {
    // Customers only ever browse live, approved restaurants.
    filter.status = VENDOR_STATUS.ACTIVE;
    filter.approvalStatus = APPROVAL_STATUS.APPROVED;
  } else {
    if (req.query.status) filter.status = req.query.status;
    if (req.query.approvalStatus) filter.approvalStatus = req.query.approvalStatus;
  }
  if (req.query.search) filter.restaurantName = { $regex: String(req.query.search), $options: 'i' };

  const { items, total } = await vendorService.listVendors(filter, pagination);
  const data = isCustomer ? items.map(toCustomerVendorView) : items;
  sendSuccess(res, data, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const vendor = await vendorService.createVendor(req.body);
  sendSuccess(res, vendor, 'Vendor created successfully', 201);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const vendor = await vendorService.getVendorById(req.params.id, user);
  sendSuccess(res, serializeForUser(vendor, user.userType));
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const vendor = await vendorService.updateVendor(req.params.id, req.body, requireUser(req));
  sendSuccess(res, vendor, 'Vendor updated successfully');
});

export const remove = catchAsync(async (req: Request, res: Response) => {
  await vendorService.deleteVendor(req.params.id, requireUser(req));
  sendSuccess(res, null, 'Vendor deleted successfully');
});

export const updateStatus = catchAsync(async (req: Request, res: Response) => {
  const vendor = await vendorService.updateVendorStatus(req.params.id, req.body.status, requireUser(req));
  sendSuccess(res, vendor, 'Vendor status updated');
});

export const approve = catchAsync(async (req: Request, res: Response) => {
  const vendor = await vendorService.approveVendor(req.params.id, requireUser(req));
  sendSuccess(res, vendor, 'Vendor approved successfully');
});

export const reject = catchAsync(async (req: Request, res: Response) => {
  const result = await vendorService.rejectVendor(req.params.id, req.body.reason, requireUser(req));
  sendSuccess(res, result.vendor, 'Vendor rejected');
});

export const suspend = catchAsync(async (req: Request, res: Response) => {
  const vendor = await vendorService.suspendVendor(req.params.id, requireUser(req));
  sendSuccess(res, vendor, 'Vendor suspended');
});

export const activate = catchAsync(async (req: Request, res: Response) => {
  const vendor = await vendorService.activateVendor(req.params.id, requireUser(req));
  sendSuccess(res, vendor, 'Vendor activated');
});

export const dashboard = catchAsync(async (req: Request, res: Response) => {
  const data = await vendorService.getVendorDashboard(req.params.id, requireUser(req));
  sendSuccess(res, data);
});

export const products = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req, { createdAt: -1 });

  // A customer browsing a restaurant's menu should only ever see items the
  // vendor still lists and currently has in stock; the vendor/admin managing
  // the menu needs to see everything, including OUT_OF_STOCK/INACTIVE rows.
  const filter: Record<string, unknown> = {};
  if (user.userType === 'CUSTOMER') {
    filter.status = GENERIC_STATUS.ACTIVE;
    filter.availabilityStatus = VENDOR_FOOD_ITEM_AVAILABILITY.AVAILABLE;
  }

  const { items, total } = await vendorService.getVendorProducts(req.params.id, user, pagination, filter);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const listDocuments = catchAsync(async (req: Request, res: Response) => {
  const documents = await vendorService.listVendorDocuments(req.params.vendorId, requireUser(req));
  sendSuccess(res, documents);
});

export const addDocument = catchAsync(async (req: Request, res: Response) => {
  const document = await vendorService.addVendorDocument(req.params.vendorId, req.body, requireUser(req));
  sendSuccess(res, document, 'Document added successfully', 201);
});

export const updateDocument = catchAsync(async (req: Request, res: Response) => {
  const document = await vendorService.updateVendorDocument(
    req.params.vendorId,
    req.params.documentId,
    req.body,
    requireUser(req),
  );
  sendSuccess(res, document, 'Document updated successfully');
});

export const deleteDocument = catchAsync(async (req: Request, res: Response) => {
  await vendorService.deleteVendorDocument(req.params.vendorId, req.params.documentId, requireUser(req));
  sendSuccess(res, null, 'Document deleted successfully');
});
