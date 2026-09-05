import { z } from 'zod';
import { GENERIC_STATUS } from '../constants/enums';

const objectId = z.string().length(24);

export const createInstamartProductSchema = z.object({
  body: z.object({
    storeId: objectId,
    categoryId: objectId,
    subcategoryId: objectId.optional(),
    name: z.string().min(2),
    brand: z.string().optional(),
    sku: z.string().min(1),
    barcode: z.string().optional(),
    mrp: z.number().nonnegative(),
    sellingPrice: z.number().nonnegative(),
    discount: z.number().nonnegative().default(0),
    tax: z.number().nonnegative().default(0),
    unit: z.string().min(1),
    packSize: z.string().optional(),
    weight: z.number().nonnegative().optional(),
    images: z.array(z.string().url()).default([]),
  }),
});

export const updateInstamartProductSchema = z.object({
  params: z.object({ id: objectId }),
  body: createInstamartProductSchema.shape.body.omit({ storeId: true }).partial(),
});

export const instamartProductIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const updateInstamartProductStatusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ status: z.enum([GENERIC_STATUS.ACTIVE, GENERIC_STATUS.INACTIVE]) }),
});
