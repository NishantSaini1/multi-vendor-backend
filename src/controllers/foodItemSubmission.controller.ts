import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import * as foodItemSubmissionService from '../services/foodItemSubmission.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const list = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req);

  const filter: Record<string, unknown> = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.vendorId && user.userType === 'ADMIN') filter.vendorId = req.query.vendorId;

  const { items, total } = await foodItemSubmissionService.listFoodItemSubmissions(filter, pagination, user);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const submission = await foodItemSubmissionService.createFoodItemSubmission(user.userId, req.body);
  sendSuccess(res, submission, 'Food item submission created successfully', 201);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const submission = await foodItemSubmissionService.getFoodItemSubmissionById(req.params.id, requireUser(req));
  sendSuccess(res, submission);
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const submission = await foodItemSubmissionService.updateFoodItemSubmission(req.params.id, req.body);
  sendSuccess(res, submission, 'Food item submission updated successfully');
});

export const approve = catchAsync(async (req: Request, res: Response) => {
  const submission = await foodItemSubmissionService.approveFoodItemSubmission(req.params.id, requireUser(req));
  sendSuccess(res, submission, 'Food item submission approved successfully');
});

export const reject = catchAsync(async (req: Request, res: Response) => {
  const submission = await foodItemSubmissionService.rejectFoodItemSubmission(
    req.params.id,
    req.body.rejectionReason,
    requireUser(req),
  );
  sendSuccess(res, submission, 'Food item submission rejected');
});
