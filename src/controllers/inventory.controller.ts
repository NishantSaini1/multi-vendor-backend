import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import * as inventoryService from '../services/inventory.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const list = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req);

  const filter: Record<string, unknown> = inventoryService.inventoryListFilter(user);
  if (req.query.storeId) filter.storeId = req.query.storeId;
  if (req.query.status) filter.status = req.query.status;

  const { items, total } = await inventoryService.listInventory(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const inventory = await inventoryService.getInventoryById(req.params.id, requireUser(req));
  sendSuccess(res, inventory);
});

export const getByProduct = catchAsync(async (req: Request, res: Response) => {
  const records = await inventoryService.getInventoryByProduct(req.params.productId, requireUser(req));
  sendSuccess(res, records);
});

export const adjust = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const inventory = await inventoryService.adjustInventory(req.body, user, user.userId);
  sendSuccess(res, inventory, 'Inventory adjusted successfully');
});

export const bulkUpdate = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const results = await inventoryService.bulkUpdateInventory(req.body.updates, user, user.userId);
  sendSuccess(res, results, 'Inventory bulk-updated successfully');
});

export const history = catchAsync(async (req: Request, res: Response) => {
  const pagination = parsePagination(req);
  const { items, total } = await inventoryService.getInventoryHistory(req.params.id, requireUser(req), pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const lowStock = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req);
  const filter: Record<string, unknown> = inventoryService.inventoryListFilter(user);
  if (req.query.storeId) filter.storeId = req.query.storeId;

  const { items, total } = await inventoryService.getLowStockInventory(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const outOfStock = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req);
  const filter: Record<string, unknown> = inventoryService.inventoryListFilter(user);
  if (req.query.storeId) filter.storeId = req.query.storeId;

  const { items, total } = await inventoryService.getOutOfStockInventory(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});
