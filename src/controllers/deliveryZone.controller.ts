import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import { locationScopeFilter } from '../middleware/rbac.middleware';
import * as deliveryZoneService from '../services/deliveryZone.service';

export const list = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const pagination = parsePagination(req, { name: 1 });

  const filter: Record<string, unknown> = { ...locationScopeFilter(req.user) };
  if (req.query.locationId) filter.locationId = req.query.locationId;
  if (req.query.status) filter.status = req.query.status;

  const { items, total } = await deliveryZoneService.listDeliveryZones(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const zone = await deliveryZoneService.createDeliveryZone(req.body);
  sendSuccess(res, zone, 'Delivery zone created successfully', 201);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const zone = await deliveryZoneService.getDeliveryZoneById(req.params.id, req.user);
  sendSuccess(res, zone);
});

export const update = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const zone = await deliveryZoneService.updateDeliveryZone(req.params.id, req.body, req.user);
  sendSuccess(res, zone, 'Delivery zone updated successfully');
});

export const remove = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  await deliveryZoneService.deleteDeliveryZone(req.params.id, req.user);
  sendSuccess(res, null, 'Delivery zone deleted successfully');
});

export const updateStatus = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const zone = await deliveryZoneService.updateDeliveryZoneStatus(req.params.id, req.body.status, req.user);
  sendSuccess(res, zone, 'Delivery zone status updated');
});
