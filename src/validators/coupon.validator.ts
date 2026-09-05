import { z } from 'zod';
import { DISCOUNT_TYPES, GENERIC_STATUS } from '../constants/enums';
import { BUSINESS_TYPES } from '../constants/orderStatus';

const objectId = z.string().length(24);

export const createCouponSchema = z.object({
  body: z
    .object({
      code: z.string().trim().min(3).max(30),
      discountType: z.enum(Object.values(DISCOUNT_TYPES) as [string, ...string[]]),
      discountValue: z.number().positive(),
      minimumOrder: z.number().nonnegative().default(0),
      maximumDiscount: z.number().positive().optional(),
      usageLimit: z.number().int().positive().optional(),
      perUserLimit: z.number().int().positive().default(1),
      locationIds: z.array(objectId).default([]),
      businessTypes: z.array(z.enum([BUSINESS_TYPES.FOOD, BUSINESS_TYPES.INSTAMART])).default([]),
      vendorIds: z.array(objectId).default([]),
      storeIds: z.array(objectId).default([]),
      categoryIds: z.array(objectId).default([]),
      startDate: z.coerce.date(),
      endDate: z.coerce.date(),
    })
    .refine((data) => data.startDate < data.endDate, { message: 'startDate must be before endDate', path: ['endDate'] }),
});

export const couponIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const updateCouponSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    discountType: z.enum(Object.values(DISCOUNT_TYPES) as [string, ...string[]]).optional(),
    discountValue: z.number().positive().optional(),
    minimumOrder: z.number().nonnegative().optional(),
    maximumDiscount: z.number().positive().optional(),
    usageLimit: z.number().int().positive().optional(),
    perUserLimit: z.number().int().positive().optional(),
    locationIds: z.array(objectId).optional(),
    businessTypes: z.array(z.enum([BUSINESS_TYPES.FOOD, BUSINESS_TYPES.INSTAMART])).optional(),
    vendorIds: z.array(objectId).optional(),
    storeIds: z.array(objectId).optional(),
    categoryIds: z.array(objectId).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  }),
});

export const updateCouponStatusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ status: z.enum(Object.values(GENERIC_STATUS) as [string, ...string[]]) }),
});

export const listCouponsQuerySchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    sort: z.string().optional(),
    status: z.enum(Object.values(GENERIC_STATUS) as [string, ...string[]]).optional(),
  }),
});
