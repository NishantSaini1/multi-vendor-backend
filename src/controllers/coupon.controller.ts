import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import * as couponService from '../services/coupon.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

// ADMIN sees every coupon (filterable); a VENDOR/STORE sees its own, or
// with ?scope=platform the admin-run coupons that apply to it.
export const list = catchAsync(async (req: Request, res: Response) => {
  const pagination = parsePagination(req);
  const filter = await couponService.couponListFilter(requireUser(req), req.query as couponService.CouponListQuery);

  const { items, total } = await couponService.listCoupons(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const listActive = catchAsync(async (req: Request, res: Response) => {
  const coupons = await couponService.listActiveCouponsForCustomer({
    locationId: req.query.locationId as string,
    businessType: req.query.businessType as string,
    vendorId: req.query.vendorId as string | undefined,
    storeId: req.query.storeId as string | undefined,
  });
  sendSuccess(res, coupons);
});

export const preview = catchAsync(async (req: Request, res: Response) => {
  const { code, ...ctx } = req.body;
  const result = await couponService.previewCoupon(code, { ...ctx, customerId: req.user!.userId });
  sendSuccess(res, result);
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const coupon = await couponService.createCoupon(req.body, requireUser(req));
  sendSuccess(res, coupon, 'Coupon created', 201);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const coupon = await couponService.getCouponById(req.params.id, requireUser(req));
  sendSuccess(res, coupon);
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const coupon = await couponService.updateCoupon(req.params.id, req.body, requireUser(req));
  sendSuccess(res, coupon, 'Coupon updated');
});

export const remove = catchAsync(async (req: Request, res: Response) => {
  await couponService.deleteCoupon(req.params.id, requireUser(req));
  sendSuccess(res, null, 'Coupon deleted');
});

export const updateStatus = catchAsync(async (req: Request, res: Response) => {
  const coupon = await couponService.updateCouponStatus(req.params.id, req.body.status, requireUser(req));
  sendSuccess(res, coupon, 'Coupon status updated');
});
