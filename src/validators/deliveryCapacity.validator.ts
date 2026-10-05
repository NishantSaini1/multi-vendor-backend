import { z } from 'zod';
import { DELIVERY_CAPACITY_MODES } from '../models/DeliveryCapacitySetting';

const objectId = z.string().length(24);

export const capacityStatusQuerySchema = z.object({
  query: z.object({ locationId: objectId }),
});

// No locationId = the global setting.
export const capacitySettingsQuerySchema = z.object({
  query: z.object({ locationId: objectId.optional() }),
});

export const updateCapacitySettingsSchema = z.object({
  body: z
    .object({
      // Omitted/null = the global setting applied to every location without its own.
      locationId: objectId.nullable().optional(),
      mode: z.enum(Object.values(DELIVERY_CAPACITY_MODES) as [string, ...string[]]).optional(),
      minAvailablePartners: z.number().int().min(1).max(100).optional(),
      // null clears it back to the auto-assign radius.
      radiusKm: z.number().min(0.5).max(50).nullable().optional(),
      // null / empty clears it back to the default message.
      message: z.string().max(280).nullable().optional(),
    })
    .strict(),
});
