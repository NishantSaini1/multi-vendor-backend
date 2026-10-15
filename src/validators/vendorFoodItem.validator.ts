import { z } from 'zod';
import { FOOD_TYPE, QUANTITY_UNIT, VARIANT_TYPE, GENERIC_STATUS, VENDOR_FOOD_ITEM_AVAILABILITY } from '../constants/enums';

const objectId = z.string().length(24);

// Quantity of one unit, e.g. 6 PIECE / 500 GRAM. null clears it (update only).
const quantityUnitEnum = z.enum(Object.values(QUANTITY_UNIT) as [string, ...string[]]);
const quantityFields = {
  quantityValue: z.number().positive().optional(),
  quantityUnit: quantityUnitEnum.optional(),
};
const quantityUpdateFields = {
  quantityValue: z.number().positive().nullable().optional(),
  quantityUnit: quantityUnitEnum.nullable().optional(),
};

// Variant-only fields (see FoodVariant). null clears one (update only).
const variantTypeEnum = z.enum(Object.values(VARIANT_TYPE) as [string, ...string[]]);
const variantAvailabilityEnum = z.enum(['AVAILABLE', 'OUT_OF_STOCK']);
const variantExtraFields = {
  variantType: variantTypeEnum.optional(),
  mrp: z.number().nonnegative().optional(),
  sku: z.string().trim().max(60).optional(),
  availabilityStatus: variantAvailabilityEnum.optional(),
};
const variantExtraUpdateFields = {
  variantType: variantTypeEnum.nullable().optional(),
  mrp: z.number().nonnegative().nullable().optional(),
  sku: z.string().trim().max(60).nullable().optional(),
  availabilityStatus: variantAvailabilityEnum.optional(),
};

// Per-vendor overrides of the shared catalog entry (see VendorFoodItem model).
// null clears an override (falls back to the catalog value).
const vendorOverrideFields = {
  name: z.string().trim().min(1).max(150).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  images: z.array(z.string()).max(10).nullable().optional(),
  foodType: z.enum(Object.values(FOOD_TYPE) as [string, ...string[]]).nullable().optional(),
  categoryId: objectId.nullable().optional(),
  subcategoryId: objectId.nullable().optional(),
};

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
    // The Selling Price (what customers pay): `price`, or `platformSellingPrice` as an alias.
    price: z.number().nonnegative().optional(),
    platformSellingPrice: z.number().nonnegative().optional(),
    // Admin-only: fixed per-unit markup amount (MARKUP vendors).
    markupAmount: z.number().nonnegative().optional(),
    // Temporary compatibility for older admin clients.
    markupPercent: z.number().min(0).max(1000).optional(),
    mrp: z.number().nonnegative().optional(),
    costPrice: z.number().nonnegative().optional(),
    preparationTime: z.number().int().positive().default(20),
    vendorSku: z.string().optional(),
    ...quantityFields,
  }),
});

export const updateVendorFoodItemSchema = z.object({
  params: z.object({ vendorId: objectId, id: objectId }),
  body: z.object({
    price: z.number().nonnegative().optional(),
    // Alias of `price`.
    platformSellingPrice: z.number().nonnegative().optional(),
    // Admin-only fixed per-unit markup amount (MARKUP vendors).
    markupAmount: z.number().nonnegative().optional(),
    // Temporary compatibility for older admin clients.
    markupPercent: z.number().min(0).max(1000).optional(),
    mrp: z.number().nonnegative().optional(),
    costPrice: z.number().nonnegative().optional(),
    preparationTime: z.number().int().positive().optional(),
    vendorSku: z.string().optional(),
    ...quantityUpdateFields,
    ...vendorOverrideFields,
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
    // Optional: defaults to the variant type / quantity ("Half Plate", "6 Pieces").
    name: z.string().trim().min(1).optional(),
    price: z.number().nonnegative(),
    isDefault: z.boolean().default(false),
    ...variantExtraFields,
    ...quantityFields,
  }),
});

export const updateFoodVariantSchema = z.object({
  params: z.object({ vendorId: objectId, id: objectId, variantId: objectId }),
  body: z.object({
    name: z.string().trim().min(1).optional(),
    price: z.number().nonnegative().optional(),
    isDefault: z.boolean().optional(),
    ...variantExtraUpdateFields,
    ...quantityUpdateFields,
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
