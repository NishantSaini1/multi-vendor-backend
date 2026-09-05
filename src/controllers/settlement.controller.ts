import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import * as settlementService from '../services/settlement.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const generate = catchAsync(async (req: Request, res: Response) => {
  const result = await settlementService.generateSettlements(req.body, requireUser(req));
  sendSuccess(res, result, 'Settlements generated', 201);
});

export const list = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req);

  const filter: Record<string, unknown> = settlementService.settlementListFilter(user);
  if (user.userType === 'ADMIN') {
    if (req.query.payeeType) filter.payeeType = req.query.payeeType;
    if (req.query.payeeId) filter.payeeId = req.query.payeeId;
    if (req.query.locationId) filter.locationId = req.query.locationId;
  }
  if (req.query.status) filter.status = req.query.status;

  const { items, total } = await settlementService.listSettlements(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const settlement = await settlementService.getSettlementById(req.params.id, requireUser(req));
  sendSuccess(res, settlement);
});

export const updateAdjustments = catchAsync(async (req: Request, res: Response) => {
  const settlement = await settlementService.updateSettlementAdjustments(req.params.id, req.body.adjustments, requireUser(req));
  sendSuccess(res, settlement, 'Settlement adjustments updated');
});

export const process = catchAsync(async (req: Request, res: Response) => {
  const settlement = await settlementService.processSettlement(req.params.id, requireUser(req));
  sendSuccess(res, settlement, 'Settlement is now processing');
});

export const pay = catchAsync(async (req: Request, res: Response) => {
  const settlement = await settlementService.paySettlement(req.params.id, req.body.transactionReference, requireUser(req));
  sendSuccess(res, settlement, 'Settlement marked as paid');
});
