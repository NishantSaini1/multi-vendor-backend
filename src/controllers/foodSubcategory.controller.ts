import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import * as foodSubcategoryService from '../services/foodSubcategory.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const list = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req, { sortOrder: 1 });

  const { items, total } = await foodSubcategoryService.listFoodSubcategories(
    { categoryId: req.query.categoryId as string | undefined, status: req.query.status as string | undefined },
    pagination,
    user,
  );
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const subcategory = await foodSubcategoryService.createFoodSubcategory(req.body, requireUser(req));
  sendSuccess(res, subcategory, 'Food subcategory created successfully', 201);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const subcategory = await foodSubcategoryService.getFoodSubcategoryById(req.params.id, requireUser(req));
  sendSuccess(res, subcategory);
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const subcategory = await foodSubcategoryService.updateFoodSubcategory(req.params.id, req.body, requireUser(req));
  sendSuccess(res, subcategory, 'Food subcategory updated successfully');
});

export const remove = catchAsync(async (req: Request, res: Response) => {
  await foodSubcategoryService.deleteFoodSubcategory(req.params.id, requireUser(req));
  sendSuccess(res, null, 'Food subcategory deleted successfully');
});

export const updateStatus = catchAsync(async (req: Request, res: Response) => {
  const subcategory = await foodSubcategoryService.updateFoodSubcategoryStatus(
    req.params.id,
    req.body.status,
    requireUser(req),
  );
  sendSuccess(res, subcategory, 'Food subcategory status updated');
});
