import { z } from 'zod';
import { GENERIC_STATUS } from '../constants/enums';

const objectId = z.string().length(24);

// A store either (A) maps itself onto an existing, already-APPROVED global
// product via `productId`, or (B) proposes a brand-new one via `newProduct` —
// auto-approved immediately, no admin review gate (see
// instamartProduct.service.ts). Exactly one of the two must be given.
const newProductSchema = z.object({
  categoryId: objectId,
  subcategoryId: objectId.optional(),
  name: z.string().min(2),
  brand: z.string().optional(),
  description: z.string().optional(),
  unit: z.string().min(1),
  packSize: z.string().optional(),
  weight: z.number().nonnegative().optional(),
  images: z.array(z.string().url()).default([]),
  barcode: z.string().optional(),
  hsn: z.string().optional(),
  gst: z.number().nonnegative().default(0),
  mrp: z.number().nonnegative(),
});

export const createInstamartProductSchema = z.object({
  body: z
    .object({
      // storeId is ignored (and derived server-side) for a store actor; required
      // for an admin actor — enforced in the service, not here.
      storeId: objectId.optional(),
      productId: objectId.optional(),
      newProduct: newProductSchema.optional(),
      sku: z.string().min(1).optional(),
      sellingPrice: z.number().nonnegative(),
      discount: z.number().nonnegative().default(0),
      sortOrder: z.number().int().default(0),
    })
    .refine((data) => Boolean(data.productId) !== Boolean(data.newProduct), {
      message: 'Provide exactly one of productId (existing product) or newProduct (propose a new one)',
      path: ['productId'],
    }),
});

export const updateInstamartProductSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    sku: z.string().min(1).optional(),
    sellingPrice: z.number().nonnegative().optional(),
    discount: z.number().nonnegative().optional(),
    sortOrder: z.number().int().optional(),
  }),
});

export const instamartProductIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const updateInstamartProductStatusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ status: z.enum([GENERIC_STATUS.ACTIVE, GENERIC_STATUS.INACTIVE]) }),
});

export const createInstamartVariantSchema = z.object({
  params: z.object({ productId: objectId }),
  body: z.object({
    name: z.string().min(1),
    mrp: z.number().nonnegative(),
    sellingPrice: z.number().nonnegative(),
    isDefault: z.boolean().default(false),
  }),
});

export const updateInstamartVariantSchema = z.object({
  params: z.object({ productId: objectId, variantId: objectId }),
  body: z.object({
    name: z.string().min(1).optional(),
    mrp: z.number().nonnegative().optional(),
    sellingPrice: z.number().nonnegative().optional(),
    isDefault: z.boolean().optional(),
    status: z.enum([GENERIC_STATUS.ACTIVE, GENERIC_STATUS.INACTIVE]).optional(),
  }),
});

export const instamartVariantParamsSchema = z.object({
  params: z.object({ productId: objectId, variantId: objectId }),
});

export const instamartProductVariantsListSchema = z.object({
  params: z.object({ productId: objectId }),
});
