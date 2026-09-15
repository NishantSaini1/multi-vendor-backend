import { z } from 'zod';

const objectId = z.string().length(24);

export const addCartItemSchema = z.object({
  body: z.object({
    vendorFoodItemId: objectId,
    variantId: objectId.optional(),
    quantity: z.number().int().positive().default(1),
    selectedModifierOptionIds: z.array(objectId).default([]),
  }),
});

export const updateCartItemSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    quantity: z.number().int().positive(),
  }),
});

export const cartItemIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});
