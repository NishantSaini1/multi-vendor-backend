import { z } from 'zod';
import { GENERIC_STATUS } from '../constants/enums';

const objectId = z.string().length(24);

export const createVendorTypeSchema = z.object({
  body: z.object({
    name: z.string().min(2),
    slug: z.string().min(2).optional(),
    image: z.string().url().optional(),
    icon: z.string().optional(),
    displayOrder: z.number().int().default(0),
  }),
});

export const updateVendorTypeSchema = z.object({
  params: z.object({ id: objectId }),
  body: createVendorTypeSchema.shape.body.partial(),
});

export const vendorTypeIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const updateVendorTypeStatusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ status: z.enum([GENERIC_STATUS.ACTIVE, GENERIC_STATUS.INACTIVE]) }),
});
