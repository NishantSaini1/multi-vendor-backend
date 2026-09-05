import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import * as commissionService from '../services/commission.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const list = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req);

  const filter: Record<string, unknown> = commissionService.commissionListFilter(user);
  if (req.query.level) filter.level = req.query.level;
  if (req.query.locationId) filter.locationId = req.query.locationId;
  if (req.query.vendorId) filter.vendorId = req.query.vendorId;
  if (req.query.storeId) filter.storeId = req.query.storeId;
  if (req.query.status) filter.status = req.query.status;

  const { items, total } = await commissionService.listCommissions(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const commission = await commissionService.createCommission(req.body, requireUser(req));
  sendSuccess(res, commission, 'Commission rule created', 201);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const commission = await commissionService.getCommissionById(req.params.id, requireUser(req));
  sendSuccess(res, commission);
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const commission = await commissionService.updateCommission(req.params.id, req.body, requireUser(req));
  sendSuccess(res, commission, 'Commission rule updated');
});

export const remove = catchAsync(async (req: Request, res: Response) => {
  await commissionService.deleteCommission(req.params.id, requireUser(req));
  sendSuccess(res, null, 'Commission rule deleted');
});

export const updateStatus = catchAsync(async (req: Request, res: Response) => {
  const commission = await commissionService.updateCommissionStatus(req.params.id, req.body.status, requireUser(req));
  sendSuccess(res, commission, 'Commission rule status updated');
});
