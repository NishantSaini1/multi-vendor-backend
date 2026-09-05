import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import * as foodCategoryService from '../services/foodCategory.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const list = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req, { sortOrder: 1 });

  const filter: Record<string, unknown> = foodCategoryService.foodCategoryListFilter(user);
  if (req.query.locationId) filter.locationId = req.query.locationId;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.vendorId && user.userType !== 'VENDOR') filter.vendorId = req.query.vendorId;

  const { items, total } = await foodCategoryService.listFoodCategories(filter, pagination, user);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const category = await foodCategoryService.createFoodCategory(req.body, requireUser(req));
  sendSuccess(res, category, 'Food category created successfully', 201);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const category = await foodCategoryService.getFoodCategoryById(req.params.id, requireUser(req));
  sendSuccess(res, category);
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const category = await foodCategoryService.updateFoodCategory(req.params.id, req.body, requireUser(req));
  sendSuccess(res, category, 'Food category updated successfully');
});

export const remove = catchAsync(async (req: Request, res: Response) => {
  await foodCategoryService.deleteFoodCategory(req.params.id, requireUser(req));
  sendSuccess(res, null, 'Food category deleted successfully');
});

export const updateStatus = catchAsync(async (req: Request, res: Response) => {
  const category = await foodCategoryService.updateFoodCategoryStatus(req.params.id, req.body.status, requireUser(req));
  sendSuccess(res, category, 'Food category status updated');
});
