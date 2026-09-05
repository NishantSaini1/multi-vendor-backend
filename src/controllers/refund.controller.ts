import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import * as refundService from '../services/refund.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const create = catchAsync(async (req: Request, res: Response) => {
  const refund = await refundService.createRefund(req.body, requireUser(req));
  sendSuccess(res, refund, 'Refund processed', 201);
});

export const list = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req);

  const filter: Record<string, unknown> = refundService.refundListFilter(user);
  if (req.query.orderId) filter.orderId = req.query.orderId;
  if (req.query.status) filter.status = req.query.status;
  if (user.userType === 'ADMIN' && req.query.customerId) filter.customerId = req.query.customerId;

  const { items, total } = await refundService.listRefunds(filter, user, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const refund = await refundService.getRefundById(req.params.id, requireUser(req));
  sendSuccess(res, refund);
});
