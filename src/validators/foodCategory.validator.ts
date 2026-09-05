import { z } from 'zod';
import { GENERIC_STATUS } from '../constants/enums';

const objectId = z.string().length(24);

export const createFoodCategorySchema = z.object({
  body: z.object({
    locationId: objectId.nullable().optional(),
    name: z.string().min(2),
    image: z.string().url().optional(),
    sortOrder: z.number().int().default(0),
  }),
});

export const updateFoodCategorySchema = z.object({
  params: z.object({ id: objectId }),
  body: createFoodCategorySchema.shape.body.partial(),
});

export const foodCategoryIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const updateFoodCategoryStatusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ status: z.enum([GENERIC_STATUS.ACTIVE, GENERIC_STATUS.INACTIVE]) }),
});
