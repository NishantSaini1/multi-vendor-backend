import { z } from 'zod';
import { FOOD_TYPE, GLOBAL_FOOD_ITEM_STATUS } from '../constants/enums';

const objectId = z.string().length(24);

const nutritionInfoSchema = z.object({
  calories: z.number().nonnegative().optional(),
  protein: z.number().nonnegative().optional(),
  carbs: z.number().nonnegative().optional(),
  fat: z.number().nonnegative().optional(),
});

export const createFoodProductSchema = z.object({
  body: z.object({
    categoryId: objectId,
    subcategoryId: objectId.optional(),
    name: z.string().min(2),
    slug: z.string().min(2).optional(),
    description: z.string().optional(),
    images: z.array(z.string().url()).default([]),
    foodType: z.enum(Object.values(FOOD_TYPE) as [string, ...string[]]).default(FOOD_TYPE.VEG),
    ingredients: z.array(z.string()).default([]),
    allergens: z.array(z.string()).default([]),
    nutritionInfo: nutritionInfoSchema.optional(),
    displayOrder: z.number().int().default(0),
  }),
});

export const updateFoodProductSchema = z.object({
  params: z.object({ id: objectId }),
  body: createFoodProductSchema.shape.body.partial(),
});

export const foodProductIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const updateFoodProductStatusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ status: z.enum(Object.values(GLOBAL_FOOD_ITEM_STATUS) as [string, ...string[]]) }),
});
