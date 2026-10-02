import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess } from '../utils/ApiResponse';
import { ApiError } from '../utils/ApiError';
import { locationScopeFilter } from '../middleware/rbac.middleware';
import { DISCOUNT_TYPES } from '../constants/enums';
import * as pricingService from '../services/pricing.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const getVendorPricing = catchAsync(async (req: Request, res: Response) => {
  sendSuccess(res, await pricingService.getVendorPricing(req.params.id, requireUser(req)));
});

export const updateVendorPricing = catchAsync(async (req: Request, res: Response) => {
  const result = await pricingService.updateVendorPricing(req.params.id, req.body, requireUser(req));
  sendSuccess(res, result, 'Vendor pricing model updated');
});

export const getStorePricing = catchAsync(async (req: Request, res: Response) => {
  sendSuccess(res, await pricingService.getStorePricing(req.params.id, requireUser(req)));
});

export const updateStorePricing = catchAsync(async (req: Request, res: Response) => {
  const result = await pricingService.updateStorePricing(req.params.id, req.body, requireUser(req));
  sendSuccess(res, result, 'Store pricing model updated');
});

// Worked example of what an order line would look like under a pricing model,
// so a vendor/admin can see the effect before saving it.
export const preview = catchAsync(async (req: Request, res: Response) => {
  const q = req.query as Record<string, string>;
  const result = pricingService.previewPricing({
    vendorPrice: Number(q.vendorPrice),
    quantity: q.quantity ? Number(q.quantity) : 1,
    config: pricingService.toPricingConfig({
      pricingModel: q.pricingModel,
      markupType: q.markupType ?? DISCOUNT_TYPES.PERCENTAGE,
      markupValue: q.markupValue ? Number(q.markupValue) : 0,
    }),
    commissionType: q.commissionType,
    commissionValue: q.commissionValue ? Number(q.commissionValue) : undefined,
  });
  sendSuccess(res, result);
});

export const earnings = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const filter: Record<string, unknown> = { ...locationScopeFilter(user) };
  if (req.query.locationId) filter.locationId = req.query.locationId;
  if (req.query.vendorId) filter.vendorId = req.query.vendorId;
  if (req.query.storeId) filter.storeId = req.query.storeId;
  if (req.query.businessType) filter.businessType = req.query.businessType;

  const range: { from?: Date; to?: Date } = {};
  if (req.query.from) range.from = new Date(String(req.query.from));
  if (req.query.to) range.to = new Date(String(req.query.to));

  sendSuccess(res, await pricingService.getPricingEarnings(filter, range));
});
