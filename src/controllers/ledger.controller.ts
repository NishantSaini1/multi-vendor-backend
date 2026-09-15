import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import * as ledgerService from '../services/ledger.service';

export const list = catchAsync(async (req: Request, res: Response) => {
  const pagination = parsePagination(req);

  const filter: Record<string, unknown> = {};
  if (req.query.vendorId) filter.vendorId = req.query.vendorId;
  if (req.query.storeId) filter.storeId = req.query.storeId;
  if (req.query.deliveryPartnerId) filter.deliveryPartnerId = req.query.deliveryPartnerId;
  if (req.query.type) filter.type = req.query.type;
  if (req.query.direction) filter.direction = req.query.direction;
  if (req.query.orderId) filter.orderId = req.query.orderId;
  if (req.query.dateFrom || req.query.dateTo) {
    const createdAt: Record<string, Date> = {};
    if (req.query.dateFrom) createdAt.$gte = new Date(String(req.query.dateFrom));
    if (req.query.dateTo) createdAt.$lte = new Date(String(req.query.dateTo));
    filter.createdAt = createdAt;
  }

  const { items, total } = await ledgerService.listTransactions(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});
