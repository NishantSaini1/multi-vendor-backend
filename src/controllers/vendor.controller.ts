import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import { locationScopeFilter } from '../middleware/rbac.middleware';
import * as vendorService from '../services/vendor.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const list = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req, { restaurantName: 1 });

  const filter: Record<string, unknown> = { ...locationScopeFilter(user) };
  if (req.query.locationId) filter.locationId = req.query.locationId;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.approvalStatus) filter.approvalStatus = req.query.approvalStatus;
  if (req.query.search) filter.restaurantName = { $regex: String(req.query.search), $options: 'i' };

  const { items, total } = await vendorService.listVendors(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const vendor = await vendorService.createVendor(req.body);
  sendSuccess(res, vendor, 'Vendor created successfully', 201);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const vendor = await vendorService.getVendorById(req.params.id, requireUser(req));
  sendSuccess(res, vendor);
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
  const pagination = parsePagination(req, { sortOrder: 1 });
  const { items, total } = await vendorService.getVendorProducts(req.params.id, requireUser(req), pagination);
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
