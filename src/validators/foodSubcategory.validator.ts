import { z } from 'zod';
import { GENERIC_STATUS } from '../constants/enums';

const objectId = z.string().length(24);

export const createFoodSubcategorySchema = z.object({
  body: z.object({
    categoryId: objectId,
    name: z.string().min(2),
    image: z.string().url().optional(),
    sortOrder: z.number().int().default(0),
  }),
});

export const updateFoodSubcategorySchema = z.object({
  params: z.object({ id: objectId }),
  body: createFoodSubcategorySchema.shape.body.partial(),
});

export const foodSubcategoryIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const updateFoodSubcategoryStatusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ status: z.enum([GENERIC_STATUS.ACTIVE, GENERIC_STATUS.INACTIVE]) }),
});
