import { z } from 'zod';
import { GENERIC_STATUS } from '../constants/enums';

const objectId = z.string().length(24);

export const createInstamartCategorySchema = z.object({
  body: z.object({
    locationId: objectId.nullable().optional(),
    name: z.string().min(2),
    image: z.string().url().optional(),
    sortOrder: z.number().int().default(0),
  }),
});

export const updateInstamartCategorySchema = z.object({
  params: z.object({ id: objectId }),
  body: createInstamartCategorySchema.shape.body.partial(),
});

export const instamartCategoryIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const updateInstamartCategoryStatusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ status: z.enum([GENERIC_STATUS.ACTIVE, GENERIC_STATUS.INACTIVE]) }),
});

export const createInstamartSubcategorySchema = z.object({
  body: z.object({
    categoryId: objectId,
    name: z.string().min(2),
    image: z.string().url().optional(),
    sortOrder: z.number().int().default(0),
  }),
});

export const updateInstamartSubcategorySchema = z.object({
  params: z.object({ id: objectId }),
  body: createInstamartSubcategorySchema.shape.body.partial(),
});

export const instamartSubcategoryIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const updateInstamartSubcategoryStatusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ status: z.enum([GENERIC_STATUS.ACTIVE, GENERIC_STATUS.INACTIVE]) }),
});
