import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess } from '../utils/ApiResponse';
import { ApiError } from '../utils/ApiError';
import { locationScopeFilter } from '../middleware/rbac.middleware';
import * as pricingService from '../services/pricing.service';
import * as orderFinancials from '../services/orderFinancials.service';
import * as financialReport from '../services/financialReport.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const getVendorPricing = catchAsync(async (req: Request, res: Response) => {
  sendSuccess(res, await pricingService.getVendorPricing(req.params.id, requireUser(req)));
});

export const updateVendorPricing = catchAsync(async (req: Request, res: Response) => {
  const result = await pricingService.updateVendorPricing(req.params.id, req.body, requireUser(req));
  sendSuccess(res, result, 'Vendor pricing updated');
});

export const getStorePricing = catchAsync(async (req: Request, res: Response) => {
  sendSuccess(res, await pricingService.getStorePricing(req.params.id, requireUser(req)));
});

export const updateStorePricing = catchAsync(async (req: Request, res: Response) => {
  const result = await pricingService.updateStorePricing(req.params.id, req.body, requireUser(req));
  sendSuccess(res, result, 'Store pricing updated');
});

// Worked example of what an order line would look like under a pricing model,
// so a vendor/admin can see the effect before saving it.
export const preview = catchAsync(async (req: Request, res: Response) => {
  const q = req.query as Record<string, string>;
  const result = orderFinancials.previewFinancials({
    sellingPrice: Number(q.sellingPrice),
    quantity: q.quantity ? Number(q.quantity) : 1,
    config: pricingService.toPricingConfig({
      pricingModel: q.pricingModel,
      commissionPercent: q.commissionPercent !== undefined ? Number(q.commissionPercent) : undefined,
    }),
    markupPercent: q.markupPercent !== undefined ? Number(q.markupPercent) : undefined,
    deliveryFee: q.deliveryFee ? Number(q.deliveryFee) : undefined,
    paymentMethod: q.paymentMethod,
  });
  sendSuccess(res, result);
});

function reportScope(req: Request) {
  const user = requireUser(req);
  const filter: Record<string, unknown> = { ...locationScopeFilter(user) };
  if (req.query.locationId) filter.locationId = req.query.locationId;
  if (req.query.vendorId) filter.vendorId = req.query.vendorId;
  if (req.query.storeId) filter.storeId = req.query.storeId;
  if (req.query.businessType) filter.businessType = req.query.businessType;

  const range: { from?: Date; to?: Date } = {};
  if (req.query.from) range.from = new Date(String(req.query.from));
  if (req.query.to) range.to = new Date(String(req.query.to));
  return { filter, range };
}

// Platform financials, Food and Instamart reported separately plus the total.
export const financialReportHandler = catchAsync(async (req: Request, res: Response) => {
  const { filter, range } = reportScope(req);
  sendSuccess(res, await financialReport.getFinancialReport(filter, range));
});

// Seller → product → order profit reports. Markup is set per product but
// reported per seller; MARKUP PROFIT and COMMISSION REVENUE stay separate.
function profitFilters(req: Request): financialReport.ProfitFilters {
  const user = requireUser(req);
  const q = req.query as Record<string, string | undefined>;
  const scope: Record<string, unknown> = { ...locationScopeFilter(user) };
  if (q.locationId) scope.locationId = q.locationId;
  const range: { from?: Date; to?: Date } = {};
  if (q.from) range.from = new Date(q.from);
  if (q.to) range.to = new Date(q.to);
  return {
    scope,
    businessType: q.businessType,
    sellerId: q.sellerId,
    productId: q.productId,
    categoryId: q.categoryId,
    subcategoryId: q.subcategoryId,
    pricingModel: q.pricingModel,
    status: q.status,
    range,
  };
}

// A vendor's/store's own earnings — always scoped to the logged-in seller, and
// without the platform's profit.
export const myEarningsSummary = catchAsync(async (req: Request, res: Response) => {
  sendSuccess(res, await financialReport.getOwnEarningsSummary(requireUser(req).userId, req.query as Record<string, string>));
});
export const myProductEarnings = catchAsync(async (req: Request, res: Response) => {
  sendSuccess(res, await financialReport.getOwnProductEarnings(requireUser(req).userId, req.query as Record<string, string>));
});
export const myOrderEarnings = catchAsync(async (req: Request, res: Response) => {
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  sendSuccess(res, await financialReport.getOwnOrderEarnings(requireUser(req).userId, req.query as Record<string, string>, limit));
});

// Vendor-level (Food) / store-level (Instamart) profit.
export const sellerFinancialsHandler = catchAsync(async (req: Request, res: Response) => {
  sendSuccess(res, await financialReport.getSellerFinancials(profitFilters(req)));
});

// Product-level profit (within a seller when sellerId is given).
export const productFinancialsHandler = catchAsync(async (req: Request, res: Response) => {
  sendSuccess(res, await financialReport.getSellerProducts(profitFilters(req)));
});

// Order-level profit (for a seller and/or product).
export const orderFinancialsHandler = catchAsync(async (req: Request, res: Response) => {
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  sendSuccess(res, await financialReport.getSellerOrders(profitFilters(req), limit));
});
