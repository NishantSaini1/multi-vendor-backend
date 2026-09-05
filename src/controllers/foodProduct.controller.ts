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
  const pagination = parsePagination(req, { sortOrder: 1 });

  const filter: Record<string, unknown> = foodProductService.foodProductListFilter(user);
  if (req.query.locationId) filter.locationId = req.query.locationId;
  if (req.query.categoryId) filter.categoryId = req.query.categoryId;
  if (req.query.vendorId && user.userType === 'ADMIN') filter.vendorId = req.query.vendorId;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.isAvailable !== undefined) filter.isAvailable = req.query.isAvailable === 'true';
  if (req.query.search) filter.name = { $regex: String(req.query.search), $options: 'i' };

  const { items, total } = await foodProductService.listFoodProducts(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const product = await foodProductService.createFoodProduct(req.body, requireUser(req));
  sendSuccess(res, product, 'Food product created successfully', 201);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const product = await foodProductService.getFoodProductById(req.params.id, requireUser(req));
  sendSuccess(res, product);
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const product = await foodProductService.updateFoodProduct(req.params.id, req.body, requireUser(req));
  sendSuccess(res, product, 'Food product updated successfully');
});

export const remove = catchAsync(async (req: Request, res: Response) => {
  await foodProductService.deleteFoodProduct(req.params.id, requireUser(req));
  sendSuccess(res, null, 'Food product deleted successfully');
});

export const updateStatus = catchAsync(async (req: Request, res: Response) => {
  const product = await foodProductService.updateFoodProductStatus(req.params.id, req.body.status, requireUser(req));
  sendSuccess(res, product, 'Food product status updated');
});

export const updateAvailability = catchAsync(async (req: Request, res: Response) => {
  const product = await foodProductService.updateFoodProductAvailability(
    req.params.id,
    req.body.isAvailable,
    requireUser(req),
  );
  sendSuccess(res, product, 'Food product availability updated');
});

export const listVariants = catchAsync(async (req: Request, res: Response) => {
  const variants = await foodProductService.listFoodVariants(req.params.productId, requireUser(req));
  sendSuccess(res, variants);
});

export const createVariant = catchAsync(async (req: Request, res: Response) => {
  const variant = await foodProductService.createFoodVariant(req.params.productId, req.body, requireUser(req));
  sendSuccess(res, variant, 'Food variant created successfully', 201);
});

export const updateVariant = catchAsync(async (req: Request, res: Response) => {
  const variant = await foodProductService.updateFoodVariant(
    req.params.productId,
    req.params.variantId,
    req.body,
    requireUser(req),
  );
  sendSuccess(res, variant, 'Food variant updated successfully');
});

export const deleteVariant = catchAsync(async (req: Request, res: Response) => {
  await foodProductService.deleteFoodVariant(req.params.productId, req.params.variantId, requireUser(req));
  sendSuccess(res, null, 'Food variant deleted successfully');
});
