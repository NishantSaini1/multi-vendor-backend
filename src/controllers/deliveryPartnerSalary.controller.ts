import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import * as salaryService from '../services/deliveryPartnerSalary.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

// ─── Salary Configs ───────────────────────────────────────────────────────────

export const listConfigs = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req);
  const filter = {
    locationId: req.query.locationId as string | undefined,
    partnerId: req.query.partnerId as string | undefined,
  };
  const { items, total } = await salaryService.listSalaryConfigs(filter, pagination, user);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const getConfig = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const config = await salaryService.getSalaryConfig(req.params.partnerId, user);
  sendSuccess(res, config);
});

export const upsertConfig = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const config = await salaryService.upsertSalaryConfig(req.params.partnerId, req.body, user);
  sendSuccess(res, config, 'Salary config saved', 200);
});

export const deleteConfig = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  await salaryService.deleteSalaryConfig(req.params.partnerId, user);
  sendSuccess(res, null, 'Salary config deleted');
});

// ─── Salary Records ───────────────────────────────────────────────────────────

export const listRecords = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req);
  const filter = {
    locationId: req.query.locationId as string | undefined,
    deliveryPartnerId: req.query.deliveryPartnerId as string | undefined,
    year: req.query.year ? Number(req.query.year) : undefined,
    month: req.query.month ? Number(req.query.month) : undefined,
    status: req.query.status as string | undefined,
  };
  const { items, total } = await salaryService.listSalaryRecords(filter, pagination, user);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const getRecord = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const record = await salaryService.getSalaryRecordById(req.params.id, user);
  sendSuccess(res, record);
});

export const generateRecords = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const { year, month, deliveryPartnerId, locationId } = req.body as {
    year: number;
    month: number;
    deliveryPartnerId?: string;
    locationId?: string;
  };

  if (deliveryPartnerId) {
    const record = await salaryService.generateSalaryRecord(deliveryPartnerId, year, month, user);
    sendSuccess(res, { created: [record], skipped: [] }, 'Salary record generated', 201);
  } else {
    const result = await salaryService.generateBulkSalaryRecords({ year, month, locationId }, user);
    sendSuccess(res, result, 'Salary records generated', 201);
  }
});

export const markPaid = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const record = await salaryService.markSalaryPaid(req.params.id, req.body.transactionReference, user);
  sendSuccess(res, record, 'Salary record marked as paid');
});
