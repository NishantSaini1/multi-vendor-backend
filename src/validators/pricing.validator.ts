import { z } from 'zod';
import { PRICING_MODELS } from '../constants/enums';
import { PAYMENT_METHODS } from '../constants/paymentStatus';
import { BUSINESS_TYPES, ORDER_STATUS_VALUES } from '../constants/orderStatus';

const objectId = z.string().length(24);
const pricingModel = z.enum(Object.values(PRICING_MODELS) as [string, ...string[]]);

export const pricingIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

// A vendor/store may only send pricingModel; commissionPercent is admin-only —
// enforced in pricing.service. Markup is per product, never set here.
export const updatePricingSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      pricingModel: pricingModel.optional(),
      // null clears it (back to the older Commission rules)
      commissionPercent: z.number().min(0).max(100).nullable().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field to update' }),
});

export const pricingPreviewQuerySchema = z.object({
  query: z.object({
    sellingPrice: z.coerce.number().positive(),
    quantity: z.coerce.number().int().positive().max(1000).optional(),
    pricingModel,
    commissionPercent: z.coerce.number().min(0).max(100).optional(),
    // The product's own markup % (MARKUP only).
    markupPercent: z.coerce.number().min(0).max(1000).optional(),
    deliveryFee: z.coerce.number().nonnegative().optional(),
    paymentMethod: z.enum(Object.values(PAYMENT_METHODS) as [string, ...string[]]).optional(),
  }),
});

// Seller → product → order profit reports. sellerId is a vendor or store id.
export const profitReportQuerySchema = z.object({
  query: z.object({
    locationId: objectId.optional(),
    sellerId: objectId.optional(),
    productId: objectId.optional(),
    categoryId: objectId.optional(),
    subcategoryId: objectId.optional(),
    businessType: z.enum([BUSINESS_TYPES.FOOD, BUSINESS_TYPES.INSTAMART]).optional(),
    pricingModel: pricingModel.optional(),
    // An order status, or ALL; DELIVERED when omitted.
    status: z.enum(['ALL', ...ORDER_STATUS_VALUES] as [string, ...string[]]).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  }),
});

// A seller's own earnings. The seller is always the logged-in vendor/store, so
// there is no sellerId (or location scope) to pass.
export const sellerEarningsQuerySchema = z.object({
  query: z.object({
    productId: objectId.optional(),
    // An order status, or ALL; DELIVERED when omitted.
    status: z.enum(['ALL', ...ORDER_STATUS_VALUES] as [string, ...string[]]).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  }),
});

export const financialReportQuerySchema = z.object({
  query: z.object({
    locationId: objectId.optional(),
    vendorId: objectId.optional(),
    storeId: objectId.optional(),
    businessType: z.enum([BUSINESS_TYPES.FOOD, BUSINESS_TYPES.INSTAMART]).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
});
