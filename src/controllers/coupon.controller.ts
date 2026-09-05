import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import * as couponService from '../services/coupon.service';

export const list = catchAsync(async (req: Request, res: Response) => {
  const pagination = parsePagination(req);
  const filter: Record<string, unknown> = couponService.couponListFilter();
  if (req.query.status) filter.status = req.query.status;

  const { items, total } = await couponService.listCoupons(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const coupon = await couponService.createCoupon(req.body);
  sendSuccess(res, coupon, 'Coupon created', 201);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const coupon = await couponService.getCouponById(req.params.id);
  sendSuccess(res, coupon);
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const coupon = await couponService.updateCoupon(req.params.id, req.body);
  sendSuccess(res, coupon, 'Coupon updated');
});

export const remove = catchAsync(async (req: Request, res: Response) => {
  await couponService.deleteCoupon(req.params.id);
  sendSuccess(res, null, 'Coupon deleted');
});

export const updateStatus = catchAsync(async (req: Request, res: Response) => {
  const coupon = await couponService.updateCouponStatus(req.params.id, req.body.status);
  sendSuccess(res, coupon, 'Coupon status updated');
});
