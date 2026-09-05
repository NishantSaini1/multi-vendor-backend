import { z } from 'zod';
import { INVENTORY_TRANSACTION_TYPES } from '../constants/enums';

const objectId = z.string().length(24);

export const inventoryIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const inventoryProductParamSchema = z.object({
  params: z.object({ productId: objectId }),
});

export const adjustInventorySchema = z.object({
  body: z.object({
    inventoryId: objectId.optional(),
    storeId: objectId.optional(),
    productId: objectId.optional(),
    type: z.enum(Object.values(INVENTORY_TRANSACTION_TYPES) as [string, ...string[]]),
    quantity: z.number().int().positive(),
    note: z.string().optional(),
  }).refine((data) => data.inventoryId || (data.storeId && data.productId), {
    message: 'Provide either inventoryId or both storeId and productId',
  }),
});

export const bulkUpdateInventorySchema = z.object({
  body: z.object({
    updates: z
      .array(
        z.object({
          inventoryId: objectId,
          currentStock: z.number().int().nonnegative(),
          note: z.string().optional(),
        }),
      )
      .min(1)
      .max(200),
  }),
});
