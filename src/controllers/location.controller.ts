import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import * as locationService from '../services/location.service';

export const list = catchAsync(async (req: Request, res: Response) => {
  const pagination = parsePagination(req, { name: 1 });
  const filter: Record<string, unknown> = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.state) filter.state = req.query.state;

  const { items, total } = await locationService.listLocations(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const location = await locationService.createLocation(req.body);
  sendSuccess(res, location, 'Location created successfully', 201);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const location = await locationService.getLocationById(req.params.id);
  sendSuccess(res, location);
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const location = await locationService.updateLocation(req.params.id, req.body);
  sendSuccess(res, location, 'Location updated successfully');
});

export const remove = catchAsync(async (req: Request, res: Response) => {
  await locationService.deleteLocation(req.params.id);
  sendSuccess(res, null, 'Location deleted successfully');
});

export const updateStatus = catchAsync(async (req: Request, res: Response) => {
  const location = await locationService.updateLocationStatus(req.params.id, req.body.status);
  sendSuccess(res, location, 'Location status updated');
});

export const dashboard = catchAsync(async (req: Request, res: Response) => {
  const data = await locationService.getLocationDashboard(req.params.id);
  sendSuccess(res, data);
});

export const getSettings = catchAsync(async (req: Request, res: Response) => {
  const settings = await locationService.getLocationSettings(req.params.id);
  sendSuccess(res, settings);
});

export const updateSettings = catchAsync(async (req: Request, res: Response) => {
  const settings = await locationService.updateLocationSettings(req.params.id, req.body.settings);
  sendSuccess(res, settings, 'Settings updated successfully');
});
