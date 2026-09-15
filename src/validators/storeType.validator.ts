import { z } from 'zod';
import { GENERIC_STATUS } from '../constants/enums';

const objectId = z.string().length(24);

export const createStoreTypeSchema = z.object({
  body: z.object({
    name: z.string().min(2),
    image: z.string().url().optional(),
    sortOrder: z.number().int().default(0),
  }),
});

export const updateStoreTypeSchema = z.object({
  params: z.object({ id: objectId }),
  body: createStoreTypeSchema.shape.body.partial(),
});

export const storeTypeIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const updateStoreTypeStatusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ status: z.enum([GENERIC_STATUS.ACTIVE, GENERIC_STATUS.INACTIVE]) }),
});
