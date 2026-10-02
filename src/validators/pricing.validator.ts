import { z } from 'zod';
import { DISCOUNT_TYPES, PRICING_MODELS } from '../constants/enums';
import { PAYMENT_METHODS } from '../constants/paymentStatus';
import { BUSINESS_TYPES } from '../constants/orderStatus';

const objectId = z.string().length(24);
const pricingModel = z.enum(Object.values(PRICING_MODELS) as [string, ...string[]]);
const markupType = z.enum(Object.values(DISCOUNT_TYPES) as [string, ...string[]]);

export const pricingIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

// A vendor/store may only send pricingModel; the rates (commissionPercent,
// the default markup) are admin-only — enforced in pricing.service.
export const updatePricingSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      pricingModel: pricingModel.optional(),
      // null clears it (back to the older Commission rules)
      commissionPercent: z.number().min(0).max(100).nullable().optional(),
      markupType: markupType.optional(),
      markupValue: z.number().min(0).max(100000).optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field to update' }),
});

export const pricingPreviewQuerySchema = z.object({
  query: z.object({
    vendorPrice: z.coerce.number().positive(),
    quantity: z.coerce.number().int().positive().max(1000).optional(),
    pricingModel,
    commissionPercent: z.coerce.number().min(0).max(100).optional(),
    markupType: markupType.optional(),
    markupValue: z.coerce.number().nonnegative().optional(),
    platformPrice: z.coerce.number().positive().optional(),
    deliveryFee: z.coerce.number().nonnegative().optional(),
    paymentMethod: z.enum(Object.values(PAYMENT_METHODS) as [string, ...string[]]).optional(),
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
