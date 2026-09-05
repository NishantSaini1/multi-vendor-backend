import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import * as customerService from '../services/customer.service';

export const list = catchAsync(async (req: Request, res: Response) => {
  const pagination = parsePagination(req);

  const filter: Record<string, unknown> = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.search) {
    const regex = { $regex: String(req.query.search), $options: 'i' };
    filter.$or = [{ name: regex }, { phone: regex }, { email: regex }];
  }

  const { items, total } = await customerService.listCustomers(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const customer = await customerService.getCustomerById(req.params.id);
  sendSuccess(res, customer);
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const customer = await customerService.updateCustomer(req.params.id, req.body);
  sendSuccess(res, customer, 'Customer updated successfully');
});

export const remove = catchAsync(async (req: Request, res: Response) => {
  await customerService.deleteCustomer(req.params.id);
  sendSuccess(res, null, 'Customer deleted successfully');
});

export const updateStatus = catchAsync(async (req: Request, res: Response) => {
  const customer = await customerService.updateCustomerStatus(req.params.id, req.body.status);
  sendSuccess(res, customer, 'Customer status updated');
});

export const dashboard = catchAsync(async (req: Request, res: Response) => {
  const data = await customerService.getCustomerDashboard(req.params.id);
  sendSuccess(res, data);
});
