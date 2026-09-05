import { z } from 'zod';
import { DISCOUNT_TYPES, GENERIC_STATUS } from '../constants/enums';
import { BUSINESS_TYPES } from '../constants/orderStatus';

const objectId = z.string().length(24);

export const createOfferSchema = z.object({
  body: z
    .object({
      title: z.string().trim().min(1),
      description: z.string().optional(),
      discountType: z.enum(Object.values(DISCOUNT_TYPES) as [string, ...string[]]),
      discountValue: z.number().positive(),
      locationIds: z.array(objectId).default([]),
      businessType: z.enum([BUSINESS_TYPES.FOOD, BUSINESS_TYPES.INSTAMART]).optional(),
      vendorIds: z.array(objectId).default([]),
      storeIds: z.array(objectId).default([]),
      startDate: z.coerce.date(),
      endDate: z.coerce.date(),
    })
    .refine((data) => data.startDate < data.endDate, { message: 'startDate must be before endDate', path: ['endDate'] }),
});

export const offerIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const updateOfferSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    title: z.string().trim().min(1).optional(),
    description: z.string().optional(),
    discountType: z.enum(Object.values(DISCOUNT_TYPES) as [string, ...string[]]).optional(),
    discountValue: z.number().positive().optional(),
    locationIds: z.array(objectId).optional(),
    businessType: z.enum([BUSINESS_TYPES.FOOD, BUSINESS_TYPES.INSTAMART]).nullable().optional(),
    vendorIds: z.array(objectId).optional(),
    storeIds: z.array(objectId).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  }),
});

export const updateOfferStatusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ status: z.enum(Object.values(GENERIC_STATUS) as [string, ...string[]]) }),
});

export const listOffersQuerySchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    sort: z.string().optional(),
    status: z.enum(Object.values(GENERIC_STATUS) as [string, ...string[]]).optional(),
  }),
});

export const activeOffersQuerySchema = z.object({
  query: z.object({
    locationId: objectId.optional(),
    businessType: z.enum([BUSINESS_TYPES.FOOD, BUSINESS_TYPES.INSTAMART]).optional(),
    vendorId: objectId.optional(),
    storeId: objectId.optional(),
  }),
});
