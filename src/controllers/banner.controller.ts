import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import * as bannerService from '../services/banner.service';

export const list = catchAsync(async (req: Request, res: Response) => {
  const pagination = parsePagination(req);
  const filter: Record<string, unknown> = {};
  if (req.query.placement) filter.placement = req.query.placement;
  if (req.query.status) filter.status = req.query.status;

  const { items, total } = await bannerService.listBanners(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const banner = await bannerService.createBanner(req.body);
  sendSuccess(res, banner, 'Banner created', 201);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const banner = await bannerService.getBannerById(req.params.id);
  sendSuccess(res, banner);
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const banner = await bannerService.updateBanner(req.params.id, req.body);
  sendSuccess(res, banner, 'Banner updated');
});

export const remove = catchAsync(async (req: Request, res: Response) => {
  await bannerService.deleteBanner(req.params.id);
  sendSuccess(res, null, 'Banner deleted');
});

export const updateStatus = catchAsync(async (req: Request, res: Response) => {
  const banner = await bannerService.updateBannerStatus(req.params.id, req.body.status);
  sendSuccess(res, banner, 'Banner status updated');
});

export const active = catchAsync(async (req: Request, res: Response) => {
  const banners = await bannerService.listActiveBanners({
    placement: req.query.placement as string,
    locationId: req.query.locationId as string | undefined,
    vendorId: req.query.vendorId as string | undefined,
    storeId: req.query.storeId as string | undefined,
  });
  sendSuccess(res, banners);
});
