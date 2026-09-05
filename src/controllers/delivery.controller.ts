import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import * as deliveryService from '../services/delivery.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const list = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req);

  const filter: Record<string, unknown> = {};
  if (user.userType === 'DELIVERY_PARTNER') {
    filter.deliveryPartnerId = user.userId;
  } else if (req.query.deliveryPartnerId) {
    filter.deliveryPartnerId = req.query.deliveryPartnerId;
  }
  if (req.query.status) filter.status = req.query.status;
  if (req.query.orderId) filter.orderId = req.query.orderId;

  const { items, total } = await deliveryService.listDeliveries(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const delivery = await deliveryService.getDeliveryById(req.params.id, requireUser(req));
  sendSuccess(res, delivery);
});

export const tracking = catchAsync(async (req: Request, res: Response) => {
  const data = await deliveryService.getDeliveryTracking(req.params.id, requireUser(req));
  sendSuccess(res, data);
});

export const updateStatus = catchAsync(async (req: Request, res: Response) => {
  const delivery = await deliveryService.updateDeliveryStatus(req.params.id, req.body.status, requireUser(req));
  sendSuccess(res, delivery, 'Delivery status updated');
});
