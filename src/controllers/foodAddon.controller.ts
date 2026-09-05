import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import * as foodAddonService from '../services/foodAddon.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const list = catchAsync(async (req: Request, res: Response) => {
  const pagination = parsePagination(req, { name: 1 });
  const { items, total } = await foodAddonService.listFoodAddons(
    { vendorId: req.query.vendorId as string | undefined, productId: req.query.productId as string | undefined },
    pagination,
    requireUser(req),
  );
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const addon = await foodAddonService.createFoodAddon(req.body, requireUser(req));
  sendSuccess(res, addon, 'Food addon created successfully', 201);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const addon = await foodAddonService.getFoodAddonById(req.params.id, requireUser(req));
  sendSuccess(res, addon);
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const addon = await foodAddonService.updateFoodAddon(req.params.id, req.body, requireUser(req));
  sendSuccess(res, addon, 'Food addon updated successfully');
});

export const remove = catchAsync(async (req: Request, res: Response) => {
  await foodAddonService.deleteFoodAddon(req.params.id, requireUser(req));
  sendSuccess(res, null, 'Food addon deleted successfully');
});
