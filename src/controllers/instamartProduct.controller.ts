import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import * as instamartProductService from '../services/instamartProduct.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const list = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req, { name: 1 });

  const filter: Record<string, unknown> = instamartProductService.instamartProductListFilter(user);
  if (req.query.locationId) filter.locationId = req.query.locationId;
  if (req.query.storeId) filter.storeId = req.query.storeId;
  if (req.query.categoryId) filter.categoryId = req.query.categoryId;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.search) filter.name = { $regex: String(req.query.search), $options: 'i' };

  const { items, total } = await instamartProductService.listInstamartProducts(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const product = await instamartProductService.createInstamartProduct(req.body, requireUser(req));
  sendSuccess(res, product, 'Instamart product created successfully', 201);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const product = await instamartProductService.getInstamartProductById(req.params.id, requireUser(req));
  sendSuccess(res, product);
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const product = await instamartProductService.updateInstamartProduct(req.params.id, req.body, requireUser(req));
  sendSuccess(res, product, 'Instamart product updated successfully');
});

export const remove = catchAsync(async (req: Request, res: Response) => {
  await instamartProductService.deleteInstamartProduct(req.params.id, requireUser(req));
  sendSuccess(res, null, 'Instamart product deleted successfully');
});

export const updateStatus = catchAsync(async (req: Request, res: Response) => {
  const product = await instamartProductService.updateInstamartProductStatus(
    req.params.id,
    req.body.status,
    requireUser(req),
  );
  sendSuccess(res, product, 'Instamart product status updated');
});
