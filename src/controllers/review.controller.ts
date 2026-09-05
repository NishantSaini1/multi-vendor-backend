import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import * as reviewService from '../services/review.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const create = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const review = await reviewService.createReview(user.userId, req.body);
  sendSuccess(res, review, 'Review created', 201);
});

export const list = catchAsync(async (req: Request, res: Response) => {
  const pagination = parsePagination(req);
  const extra: Record<string, unknown> = {};
  if (req.query.targetType) extra.targetType = req.query.targetType;
  if (req.query.targetId) extra.targetId = req.query.targetId;
  if (req.query.customerId) extra.customerId = req.query.customerId;

  const filter = reviewService.reviewListFilter(req.user, extra);
  const { items, total } = await reviewService.listReviews(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const review = await reviewService.getReviewById(req.params.id, req.user);
  sendSuccess(res, review);
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const review = await reviewService.updateReview(req.params.id, req.body, requireUser(req));
  sendSuccess(res, review, 'Review updated');
});

export const remove = catchAsync(async (req: Request, res: Response) => {
  await reviewService.deleteReview(req.params.id, requireUser(req));
  sendSuccess(res, null, 'Review deleted');
});

export const updateStatus = catchAsync(async (req: Request, res: Response) => {
  const review = await reviewService.updateReviewStatus(req.params.id, req.body.status);
  sendSuccess(res, review, 'Review status updated');
});
