import { z } from 'zod';
import { GENERIC_STATUS } from '../constants/enums';

const objectId = z.string().length(24);

export const createFoodProductSchema = z.object({
  body: z.object({
    // vendorId/locationId are ignored (and derived server-side) for a vendor actor;
    // required for an admin actor — enforced in the service, not here.
    vendorId: objectId.optional(),
    locationId: objectId.optional(),
    categoryId: objectId,
    subcategoryId: objectId.optional(),
    name: z.string().min(2),
    description: z.string().optional(),
    images: z.array(z.string().url()).default([]),
    price: z.number().nonnegative(),
    discount: z.number().nonnegative().default(0),
    tax: z.number().nonnegative().default(0),
    isVeg: z.boolean().default(true),
    isAvailable: z.boolean().default(true),
    preparationTime: z.number().int().positive().default(20),
    sortOrder: z.number().int().default(0),
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
  body: z.object({ status: z.enum([GENERIC_STATUS.ACTIVE, GENERIC_STATUS.INACTIVE]) }),
});

export const updateFoodProductAvailabilitySchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ isAvailable: z.boolean() }),
});

export const createFoodVariantSchema = z.object({
  params: z.object({ productId: objectId }),
  body: z.object({
    name: z.string().min(1),
    price: z.number().nonnegative(),
    isDefault: z.boolean().default(false),
  }),
});

export const updateFoodVariantSchema = z.object({
  params: z.object({ productId: objectId, variantId: objectId }),
  body: z.object({
    name: z.string().min(1).optional(),
    price: z.number().nonnegative().optional(),
    isDefault: z.boolean().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  }),
});

export const foodVariantParamsSchema = z.object({
  params: z.object({ productId: objectId, variantId: objectId }),
});

export const foodProductVariantsListSchema = z.object({
  params: z.object({ productId: objectId }),
});
