import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import * as instamartCategoryService from '../services/instamartCategory.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const list = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req, { sortOrder: 1 });

  const filter: Record<string, unknown> = instamartCategoryService.instamartCategoryListFilter(user);
  if (req.query.locationId) filter.locationId = req.query.locationId;
  if (req.query.status) filter.status = req.query.status;

  const { items, total } = await instamartCategoryService.listInstamartCategories(filter, pagination, user);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const category = await instamartCategoryService.createInstamartCategory(req.body, requireUser(req));
  sendSuccess(res, category, 'Instamart category created successfully', 201);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const category = await instamartCategoryService.getInstamartCategoryById(req.params.id, requireUser(req));
  sendSuccess(res, category);
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const category = await instamartCategoryService.updateInstamartCategory(req.params.id, req.body, requireUser(req));
  sendSuccess(res, category, 'Instamart category updated successfully');
});

export const remove = catchAsync(async (req: Request, res: Response) => {
  await instamartCategoryService.deleteInstamartCategory(req.params.id, requireUser(req));
  sendSuccess(res, null, 'Instamart category deleted successfully');
});

export const updateStatus = catchAsync(async (req: Request, res: Response) => {
  const category = await instamartCategoryService.updateInstamartCategoryStatus(
    req.params.id,
    req.body.status,
    requireUser(req),
  );
  sendSuccess(res, category, 'Instamart category status updated');
});

export const listSubcategories = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req, { sortOrder: 1 });

  const { items, total } = await instamartCategoryService.listInstamartSubcategories(
    { categoryId: req.query.categoryId as string | undefined, status: req.query.status as string | undefined },
    pagination,
    user,
  );
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const createSubcategory = catchAsync(async (req: Request, res: Response) => {
  const subcategory = await instamartCategoryService.createInstamartSubcategory(req.body, requireUser(req));
  sendSuccess(res, subcategory, 'Instamart subcategory created successfully', 201);
});

export const getSubcategoryById = catchAsync(async (req: Request, res: Response) => {
  const subcategory = await instamartCategoryService.getInstamartSubcategoryById(req.params.id, requireUser(req));
  sendSuccess(res, subcategory);
});

export const updateSubcategory = catchAsync(async (req: Request, res: Response) => {
  const subcategory = await instamartCategoryService.updateInstamartSubcategory(
    req.params.id,
    req.body,
    requireUser(req),
  );
  sendSuccess(res, subcategory, 'Instamart subcategory updated successfully');
});

export const removeSubcategory = catchAsync(async (req: Request, res: Response) => {
  await instamartCategoryService.deleteInstamartSubcategory(req.params.id, requireUser(req));
  sendSuccess(res, null, 'Instamart subcategory deleted successfully');
});

export const updateSubcategoryStatus = catchAsync(async (req: Request, res: Response) => {
  const subcategory = await instamartCategoryService.updateInstamartSubcategoryStatus(
    req.params.id,
    req.body.status,
    requireUser(req),
  );
  sendSuccess(res, subcategory, 'Instamart subcategory status updated');
});
