import { z } from 'zod';
import { GENERIC_STATUS, VENDOR_FOOD_ITEM_AVAILABILITY } from '../constants/enums';

const objectId = z.string().length(24);

export const vendorIdParamSchema = z.object({
  params: z.object({ vendorId: objectId }),
});

export const vendorFoodItemIdParamSchema = z.object({
  params: z.object({ vendorId: objectId, id: objectId }),
});

export const createVendorFoodItemSchema = z.object({
  params: z.object({ vendorId: objectId }),
  body: z.object({
    globalFoodItemId: objectId,
    price: z.number().nonnegative(),
    mrp: z.number().nonnegative().optional(),
    costPrice: z.number().nonnegative().optional(),
    preparationTime: z.number().int().positive().default(20),
    vendorSku: z.string().optional(),
  }),
});

export const updateVendorFoodItemSchema = z.object({
  params: z.object({ vendorId: objectId, id: objectId }),
  body: z.object({
    price: z.number().nonnegative().optional(),
    mrp: z.number().nonnegative().optional(),
    costPrice: z.number().nonnegative().optional(),
    preparationTime: z.number().int().positive().optional(),
    vendorSku: z.string().optional(),
    availabilityStatus: z.enum(Object.values(VENDOR_FOOD_ITEM_AVAILABILITY) as [string, ...string[]]).optional(),
    status: z.enum(Object.values(GENERIC_STATUS) as [string, ...string[]]).optional(),
  }),
});

export const updateVendorFoodItemAvailabilitySchema = z.object({
  params: z.object({ vendorId: objectId, id: objectId }),
  body: z.object({ availabilityStatus: z.enum(Object.values(VENDOR_FOOD_ITEM_AVAILABILITY) as [string, ...string[]]) }),
});

// --- Variants ---

export const createFoodVariantSchema = z.object({
  params: z.object({ vendorId: objectId, id: objectId }),
  body: z.object({
    name: z.string().min(1),
    price: z.number().nonnegative(),
    isDefault: z.boolean().default(false),
  }),
});

export const updateFoodVariantSchema = z.object({
  params: z.object({ vendorId: objectId, id: objectId, variantId: objectId }),
  body: z.object({
    name: z.string().min(1).optional(),
    price: z.number().nonnegative().optional(),
    isDefault: z.boolean().optional(),
    status: z.enum(Object.values(GENERIC_STATUS) as [string, ...string[]]).optional(),
  }),
});

export const foodVariantParamsSchema = z.object({
  params: z.object({ vendorId: objectId, id: objectId, variantId: objectId }),
});

// --- Modifier groups ---

export const createModifierGroupSchema = z.object({
  params: z.object({ vendorId: objectId, id: objectId }),
  body: z.object({
    name: z.string().min(1),
    minSelection: z.number().int().nonnegative().default(0),
    maxSelection: z.number().int().nonnegative().default(1),
    required: z.boolean().default(false),
  }),
});

export const updateModifierGroupSchema = z.object({
  params: z.object({ vendorId: objectId, id: objectId, groupId: objectId }),
  body: z.object({
    name: z.string().min(1).optional(),
    minSelection: z.number().int().nonnegative().optional(),
    maxSelection: z.number().int().nonnegative().optional(),
    required: z.boolean().optional(),
    status: z.enum(Object.values(GENERIC_STATUS) as [string, ...string[]]).optional(),
  }),
});

export const modifierGroupParamsSchema = z.object({
  params: z.object({ vendorId: objectId, id: objectId, groupId: objectId }),
});

// --- Modifier options ---

export const createModifierOptionSchema = z.object({
  params: z.object({ vendorId: objectId, id: objectId, groupId: objectId }),
  body: z.object({
    name: z.string().min(1),
    price: z.number().nonnegative().default(0),
  }),
});

export const updateModifierOptionSchema = z.object({
  params: z.object({ vendorId: objectId, id: objectId, groupId: objectId, optionId: objectId }),
  body: z.object({
    name: z.string().min(1).optional(),
    price: z.number().nonnegative().optional(),
    status: z.enum(Object.values(GENERIC_STATUS) as [string, ...string[]]).optional(),
  }),
});

export const modifierOptionParamsSchema = z.object({
  params: z.object({ vendorId: objectId, id: objectId, groupId: objectId, optionId: objectId }),
});
