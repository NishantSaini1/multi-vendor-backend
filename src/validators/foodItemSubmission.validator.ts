import { z } from 'zod';
import { FOOD_TYPE, FOOD_ITEM_SUBMISSION_STATUS } from '../constants/enums';

const objectId = z.string().length(24);

export const createFoodItemSubmissionSchema = z.object({
  body: z.object({
    name: z.string().min(2),
    categoryId: objectId,
    subcategoryId: objectId.optional(),
    description: z.string().optional(),
    image: z.string().url().optional(),
    foodType: z.enum(Object.values(FOOD_TYPE) as [string, ...string[]]).default(FOOD_TYPE.VEG),
    price: z.number().nonnegative(),
    mrp: z.number().nonnegative().optional(),
    preparationTime: z.number().int().positive().optional(),
  }),
});

export const updateFoodItemSubmissionSchema = z.object({
  params: z.object({ id: objectId }),
  body: createFoodItemSubmissionSchema.shape.body.partial(),
});

export const foodItemSubmissionIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const rejectFoodItemSubmissionSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ rejectionReason: z.string().min(3) }),
});

export const listFoodItemSubmissionsQuerySchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    sort: z.string().optional(),
    status: z.enum(Object.values(FOOD_ITEM_SUBMISSION_STATUS) as [string, ...string[]]).optional(),
    vendorId: objectId.optional(),
  }),
});
