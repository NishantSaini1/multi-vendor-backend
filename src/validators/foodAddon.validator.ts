import { z } from 'zod';

const objectId = z.string().length(24);

export const createFoodAddonSchema = z.object({
  body: z.object({
    vendorId: objectId.optional(),
    productIds: z.array(objectId).default([]),
    name: z.string().min(1),
    price: z.number().nonnegative(),
    maxQuantity: z.number().int().positive().default(1),
  }),
});

export const updateFoodAddonSchema = z.object({
  params: z.object({ id: objectId }),
  body: createFoodAddonSchema.shape.body.omit({ vendorId: true }).partial().extend({
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  }),
});

export const foodAddonIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});
