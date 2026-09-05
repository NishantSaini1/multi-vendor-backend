import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { locationScopeFilter } from '../middleware/rbac.middleware';
import { ApiError } from '../utils/ApiError';
import * as activityLogService from '../services/activityLog.service';

export const list = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const pagination = parsePagination(req);

  const filter: Record<string, unknown> = locationScopeFilter(req.user);
  if (req.query.userId) filter.userId = req.query.userId;
  if (req.query.module) filter.module = req.query.module;
  if (req.query.entityType) filter.entityType = req.query.entityType;
  if (req.query.action) filter.action = req.query.action;
  if (req.query.locationId) filter.locationId = req.query.locationId;
  if (req.query.from || req.query.to) {
    filter.createdAt = {
      ...(req.query.from ? { $gte: new Date(String(req.query.from)) } : {}),
      ...(req.query.to ? { $lte: new Date(String(req.query.to)) } : {}),
    };
  }

  const { items, total } = await activityLogService.listActivityLogs(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});
