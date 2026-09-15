import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import * as vendorTypeService from '../services/vendorType.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const list = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req, { displayOrder: 1 });

  const filter: Record<string, unknown> = vendorTypeService.vendorTypeListFilter(user);
  if (req.query.status && user.userType === 'ADMIN') filter.status = req.query.status;

  const { items, total } = await vendorTypeService.listVendorTypes(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const vendorType = await vendorTypeService.createVendorType(req.body);
  sendSuccess(res, vendorType, 'Vendor type created successfully', 201);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const vendorType = await vendorTypeService.getVendorTypeById(req.params.id, requireUser(req));
  sendSuccess(res, vendorType);
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const vendorType = await vendorTypeService.updateVendorType(req.params.id, req.body);
  sendSuccess(res, vendorType, 'Vendor type updated successfully');
});

export const remove = catchAsync(async (req: Request, res: Response) => {
  await vendorTypeService.deleteVendorType(req.params.id);
  sendSuccess(res, null, 'Vendor type deleted successfully');
});

export const updateStatus = catchAsync(async (req: Request, res: Response) => {
  const vendorType = await vendorTypeService.updateVendorTypeStatus(req.params.id, req.body.status);
  sendSuccess(res, vendorType, 'Vendor type status updated');
});
