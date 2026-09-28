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
  const pagination = parsePagination(req, { displayOrder: 1 });

  // Visibility (global vs vendor-owned, ACTIVE-only for non-admins) is applied
  // in the service; these are only extra, admin-only narrowing filters.
  const filter: Record<string, unknown> = {};
  if (req.query.status && user.userType === 'ADMIN') filter.status = req.query.status;
  // A customer browsing a location only sees categories that some restaurant
  // there actually sells (an admin/vendor list stays unfiltered).
  if (user.userType === 'CUSTOMER' && typeof req.query.locationId === 'string' && req.query.locationId) {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const coords =
      req.query.lat !== undefined && req.query.lng !== undefined && Number.isFinite(lat) && Number.isFinite(lng)
        ? { lat, lng }
        : undefined;
    filter._id = { $in: await foodCategoryService.categoryIdsInLocation(req.query.locationId, coords) };
  }

  const { items, total } = await foodCategoryService.listFoodCategories(
    filter,
    pagination,
    user,
    req.query.vendorId as string | undefined,
  );
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
