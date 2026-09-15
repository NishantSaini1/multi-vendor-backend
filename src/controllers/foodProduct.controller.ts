import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import * as foodProductService from '../services/foodProduct.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const list = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req, { displayOrder: 1 });

  const filter: Record<string, unknown> = foodProductService.foodProductListFilter(user);
  if (req.query.categoryId) filter.categoryId = req.query.categoryId;
  if (req.query.subcategoryId) filter.subcategoryId = req.query.subcategoryId;
  if (req.query.foodType) filter.foodType = req.query.foodType;
  if (req.query.status && user.userType === 'ADMIN') filter.status = req.query.status;
  if (req.query.search) filter.name = { $regex: String(req.query.search), $options: 'i' };

  const { items, total } = await foodProductService.listFoodProducts(filter, pagination, user);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const product = await foodProductService.createFoodProduct(req.body);
  sendSuccess(res, product, 'Food item created successfully', 201);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const product = await foodProductService.getFoodProductById(req.params.id, requireUser(req));
  sendSuccess(res, product);
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const product = await foodProductService.updateFoodProduct(req.params.id, req.body);
  sendSuccess(res, product, 'Food item updated successfully');
});

export const remove = catchAsync(async (req: Request, res: Response) => {
  await foodProductService.deleteFoodProduct(req.params.id);
  sendSuccess(res, null, 'Food item deleted successfully');
});

export const updateStatus = catchAsync(async (req: Request, res: Response) => {
  const product = await foodProductService.updateFoodProductStatus(req.params.id, req.body.status);
  sendSuccess(res, product, 'Food item status updated');
});
