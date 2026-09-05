import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess } from '../utils/ApiResponse';
import { ApiError } from '../utils/ApiError';
import * as dashboardService from '../services/dashboard.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export const overview = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const from = req.query.from ? new Date(String(req.query.from)) : startOfToday();
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  const data = await dashboardService.getOverview(user, from, to);
  sendSuccess(res, data);
});

export const ordersTrend = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const days = req.query.days ? Math.min(90, Math.max(1, parseInt(String(req.query.days), 10))) : 7;
  const data = await dashboardService.getOrdersTrend(user, days);
  sendSuccess(res, data);
});
