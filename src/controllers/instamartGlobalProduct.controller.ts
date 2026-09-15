import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import * as instamartGlobalProductService from '../services/instamartGlobalProduct.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const list = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req, { sortOrder: 1, name: 1 });

  const filter: Record<string, unknown> = instamartGlobalProductService.instamartGlobalProductListFilter(user);
  if (req.query.categoryId) filter.categoryId = req.query.categoryId;
  if (req.query.subcategoryId) filter.subcategoryId = req.query.subcategoryId;
  if (req.query.approvalStatus && user.userType === 'ADMIN') filter.approvalStatus = req.query.approvalStatus;
  if (req.query.status && user.userType === 'ADMIN') filter.status = req.query.status;
  if (req.query.search) filter.$text = { $search: String(req.query.search) };

  const { items, total } = await instamartGlobalProductService.listInstamartGlobalProducts(filter, pagination, user);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const product = await instamartGlobalProductService.createInstamartGlobalProduct(req.body, requireUser(req));
  sendSuccess(res, product, 'Instamart global product created successfully', 201);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const product = await instamartGlobalProductService.getInstamartGlobalProductById(req.params.id, requireUser(req));
  sendSuccess(res, product);
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const product = await instamartGlobalProductService.updateInstamartGlobalProduct(req.params.id, req.body, requireUser(req));
  sendSuccess(res, product, 'Instamart global product updated successfully');
});

export const remove = catchAsync(async (req: Request, res: Response) => {
  await instamartGlobalProductService.deleteInstamartGlobalProduct(req.params.id);
  sendSuccess(res, null, 'Instamart global product deleted successfully');
});

export const updateStatus = catchAsync(async (req: Request, res: Response) => {
  const product = await instamartGlobalProductService.updateInstamartGlobalProductStatus(
    req.params.id,
    req.body.status,
    requireUser(req),
  );
  sendSuccess(res, product, 'Instamart global product status updated');
});

export const approve = catchAsync(async (req: Request, res: Response) => {
  const product = await instamartGlobalProductService.approveInstamartGlobalProduct(req.params.id, requireUser(req));
  sendSuccess(res, product, 'Instamart global product approved');
});

export const reject = catchAsync(async (req: Request, res: Response) => {
  const product = await instamartGlobalProductService.rejectInstamartGlobalProduct(req.params.id, req.body.reason, requireUser(req));
  sendSuccess(res, product, 'Instamart global product rejected');
});
