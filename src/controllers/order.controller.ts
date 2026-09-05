import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import * as orderService from '../services/order.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const list = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req);

  const filter: Record<string, unknown> = orderService.orderListFilter(user);
  if (user.userType === 'ADMIN') {
    if (req.query.locationId) filter.locationId = req.query.locationId;
    if (req.query.customerId) filter.customerId = req.query.customerId;
    if (req.query.vendorId) filter.vendorId = req.query.vendorId;
    if (req.query.storeId) filter.storeId = req.query.storeId;
    if (req.query.deliveryPartnerId) filter.deliveryPartnerId = req.query.deliveryPartnerId;
  }
  if (req.query.businessType) filter.businessType = req.query.businessType;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.paymentStatus) filter.paymentStatus = req.query.paymentStatus;
  if (req.query.search) filter.orderNumber = { $regex: String(req.query.search), $options: 'i' };
  if (req.query.from || req.query.to) {
    const createdAt: Record<string, Date> = {};
    if (req.query.from) createdAt.$gte = new Date(String(req.query.from));
    if (req.query.to) createdAt.$lte = new Date(String(req.query.to));
    filter.createdAt = createdAt;
  }

  const { items, total } = await orderService.listOrders(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const order = await orderService.createOrder(user.userId, req.body);
  sendSuccess(res, order, 'Order created successfully', 201);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const order = await orderService.getOrderById(req.params.id, requireUser(req));
  sendSuccess(res, order);
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const order = await orderService.updateOrder(req.params.id, req.body, requireUser(req));
  sendSuccess(res, order, 'Order updated successfully');
});

export const updateStatus = catchAsync(async (req: Request, res: Response) => {
  const order = await orderService.updateOrderStatus(req.params.id, req.body.status, requireUser(req));
  sendSuccess(res, order, 'Order status updated');
});

export const cancel = catchAsync(async (req: Request, res: Response) => {
  const order = await orderService.cancelOrder(req.params.id, req.body.reason, requireUser(req));
  sendSuccess(res, order, 'Order cancelled successfully');
});

export const timeline = catchAsync(async (req: Request, res: Response) => {
  const history = await orderService.getOrderTimeline(req.params.id, requireUser(req));
  sendSuccess(res, history);
});

export const items = catchAsync(async (req: Request, res: Response) => {
  const orderItems = await orderService.getOrderItems(req.params.id, requireUser(req));
  sendSuccess(res, orderItems);
});
