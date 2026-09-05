import { z } from 'zod';
import { COMMISSION_LEVELS, DISCOUNT_TYPES, GENERIC_STATUS } from '../constants/enums';
import { BUSINESS_TYPES } from '../constants/orderStatus';

const objectId = z.string().length(24);

const levelScopeRefinement = (data: { level: string; locationId?: string; vendorId?: string; storeId?: string }) => {
  if (data.level === COMMISSION_LEVELS.GLOBAL) return !data.locationId && !data.vendorId && !data.storeId;
  if (data.level === COMMISSION_LEVELS.LOCATION) return !!data.locationId && !data.vendorId && !data.storeId;
  if (data.level === COMMISSION_LEVELS.VENDOR) return !!data.vendorId && !data.storeId;
  if (data.level === COMMISSION_LEVELS.STORE) return !!data.storeId && !data.vendorId;
  return false;
};

export const createCommissionSchema = z.object({
  body: z
    .object({
      level: z.enum(Object.values(COMMISSION_LEVELS) as [string, ...string[]]),
      locationId: objectId.optional(),
      vendorId: objectId.optional(),
      storeId: objectId.optional(),
      businessType: z.enum([BUSINESS_TYPES.FOOD, BUSINESS_TYPES.INSTAMART]).optional(),
      type: z.enum(Object.values(DISCOUNT_TYPES) as [string, ...string[]]),
      value: z.number().nonnegative(),
    })
    .refine(levelScopeRefinement, {
      message:
        'GLOBAL commissions take no locationId/vendorId/storeId; LOCATION requires locationId only; VENDOR requires vendorId; STORE requires storeId',
    }),
});

export const commissionIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const updateCommissionSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    type: z.enum(Object.values(DISCOUNT_TYPES) as [string, ...string[]]).optional(),
    value: z.number().nonnegative().optional(),
    businessType: z.enum([BUSINESS_TYPES.FOOD, BUSINESS_TYPES.INSTAMART]).nullable().optional(),
  }),
});

export const updateCommissionStatusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ status: z.enum(Object.values(GENERIC_STATUS) as [string, ...string[]]) }),
});

export const listCommissionsQuerySchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    sort: z.string().optional(),
    level: z.enum(Object.values(COMMISSION_LEVELS) as [string, ...string[]]).optional(),
    locationId: objectId.optional(),
    vendorId: objectId.optional(),
    storeId: objectId.optional(),
    status: z.enum(Object.values(GENERIC_STATUS) as [string, ...string[]]).optional(),
  }),
});
