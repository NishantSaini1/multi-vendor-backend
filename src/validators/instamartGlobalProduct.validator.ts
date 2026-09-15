import { z } from 'zod';
import { GENERIC_STATUS } from '../constants/enums';

const objectId = z.string().length(24);

export const createInstamartGlobalProductSchema = z.object({
  body: z.object({
    categoryId: objectId,
    subcategoryId: objectId.optional(),
    name: z.string().min(2),
    brand: z.string().optional(),
    description: z.string().optional(),
    unit: z.string().min(1),
    packSize: z.string().optional(),
    weight: z.number().nonnegative().optional(),
    images: z.array(z.string().url()).default([]),
    barcode: z.string().optional(),
    hsn: z.string().optional(),
    gst: z.number().nonnegative().default(0),
    mrp: z.number().nonnegative(),
  }),
});

export const updateInstamartGlobalProductSchema = z.object({
  params: z.object({ id: objectId }),
  body: createInstamartGlobalProductSchema.shape.body.partial(),
});

export const instamartGlobalProductIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const updateInstamartGlobalProductStatusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ status: z.enum([GENERIC_STATUS.ACTIVE, GENERIC_STATUS.INACTIVE]) }),
});

export const rejectInstamartGlobalProductSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ reason: z.string().min(1) }),
});
