import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import * as deliveryIssueService from '../services/deliveryIssue.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const create = catchAsync(async (req: Request, res: Response) => {
  const issue = await deliveryIssueService.createDeliveryIssue(req.body, requireUser(req));
  sendSuccess(res, issue, 'Delivery issue raised', 201);
});

export const list = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req);

  const filter = await deliveryIssueService.deliveryIssueListFilter(user);
  if (req.query.status) filter.status = req.query.status;
  if (req.query.type) filter.type = req.query.type;
  if (req.query.deliveryId) filter.deliveryId = req.query.deliveryId;

  const { items, total } = await deliveryIssueService.listDeliveryIssues(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const issue = await deliveryIssueService.getDeliveryIssueById(req.params.id, requireUser(req));
  sendSuccess(res, issue);
});

export const updateStatus = catchAsync(async (req: Request, res: Response) => {
  const issue = await deliveryIssueService.updateDeliveryIssueStatus(req.params.id, req.body, requireUser(req));
  sendSuccess(res, issue, 'Delivery issue updated');
});
