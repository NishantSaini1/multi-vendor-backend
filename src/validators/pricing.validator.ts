import { z } from 'zod';
import { DISCOUNT_TYPES, PRICING_MODELS } from '../constants/enums';
import { BUSINESS_TYPES } from '../constants/orderStatus';

const objectId = z.string().length(24);
const pricingModel = z.enum(Object.values(PRICING_MODELS) as [string, ...string[]]);
const markupType = z.enum(Object.values(DISCOUNT_TYPES) as [string, ...string[]]);

export const pricingIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

// MARKUP needs a positive markupValue (enforced again in pricing.service so a
// switch back to MARKUP can reuse the previously saved markup).
export const updatePricingSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      pricingModel,
      markupType: markupType.optional(),
      markupValue: z.number().positive().max(100000).optional(),
    })
    .strict(),
});

export const pricingPreviewQuerySchema = z.object({
  query: z.object({
    vendorPrice: z.coerce.number().positive(),
    quantity: z.coerce.number().int().positive().max(1000).optional(),
    pricingModel,
    markupType: markupType.optional(),
    markupValue: z.coerce.number().nonnegative().optional(),
    commissionType: markupType.optional(),
    commissionValue: z.coerce.number().nonnegative().optional(),
  }),
});

export const pricingEarningsQuerySchema = z.object({
  query: z.object({
    locationId: objectId.optional(),
    vendorId: objectId.optional(),
    storeId: objectId.optional(),
    businessType: z.enum([BUSINESS_TYPES.FOOD, BUSINESS_TYPES.INSTAMART]).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
});
