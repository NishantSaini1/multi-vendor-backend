import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import * as storeTypeService from '../services/storeType.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const list = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req, { sortOrder: 1 });

  const filter: Record<string, unknown> = storeTypeService.storeTypeListFilter(user);
  if (req.query.status && user.userType === 'ADMIN') filter.status = req.query.status;

  const { items, total } = await storeTypeService.listStoreTypes(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const storeType = await storeTypeService.createStoreType(req.body);
  sendSuccess(res, storeType, 'Store type created successfully', 201);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const storeType = await storeTypeService.getStoreTypeById(req.params.id, requireUser(req));
  sendSuccess(res, storeType);
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const storeType = await storeTypeService.updateStoreType(req.params.id, req.body);
  sendSuccess(res, storeType, 'Store type updated successfully');
});

export const remove = catchAsync(async (req: Request, res: Response) => {
  await storeTypeService.deleteStoreType(req.params.id);
  sendSuccess(res, null, 'Store type deleted successfully');
});

export const updateStatus = catchAsync(async (req: Request, res: Response) => {
  const storeType = await storeTypeService.updateStoreTypeStatus(req.params.id, req.body.status);
  sendSuccess(res, storeType, 'Store type status updated');
});
