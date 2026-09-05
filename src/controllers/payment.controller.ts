import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import * as paymentService from '../services/payment.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const createRazorpayOrder = catchAsync(async (req: Request, res: Response) => {
  const result = await paymentService.createRazorpayOrder(req.body.orderId, requireUser(req));
  sendSuccess(res, result, 'Razorpay order created', 201);
});

export const verify = catchAsync(async (req: Request, res: Response) => {
  const payment = await paymentService.verifyPayment(req.body, requireUser(req));
  sendSuccess(res, payment, 'Payment verified');
});

export const webhook = catchAsync(async (req: Request, res: Response) => {
  const signature = req.headers['x-razorpay-signature'] as string | undefined;
  const result = await paymentService.handleWebhook(req.rawBody ?? Buffer.from(JSON.stringify(req.body)), signature);
  sendSuccess(res, result);
});

export const list = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req);

  const filter: Record<string, unknown> = paymentService.paymentListFilter(user);
  if (req.query.orderId) filter.orderId = req.query.orderId;
  if (req.query.status) filter.status = req.query.status;
  if (user.userType === 'ADMIN' && req.query.customerId) filter.customerId = req.query.customerId;

  const { items, total } = await paymentService.listPayments(filter, user, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const payment = await paymentService.getPaymentById(req.params.id, requireUser(req));
  sendSuccess(res, payment);
});
