import { z } from 'zod';
import { GENERIC_STATUS } from '../constants/enums';

export const createLocationSchema = z.object({
  body: z.object({
    name: z.string().min(2),
    code: z.string().min(2).max(20),
    state: z.string().min(2),
    district: z.string().min(2),
    pincodes: z.array(z.string()).default([]),
    latitude: z.number(),
    longitude: z.number(),
    serviceRadius: z.number().positive().default(10),
    timezone: z.string().default('Asia/Kolkata'),
    currency: z.string().default('INR'),
    settings: z.record(z.unknown()).optional(),
  }),
});

export const updateLocationSchema = z.object({
  params: z.object({ id: z.string().length(24) }),
  body: createLocationSchema.shape.body.partial(),
});

export const idParamSchema = z.object({
  params: z.object({ id: z.string().length(24) }),
});

export const updateLocationStatusSchema = z.object({
  params: z.object({ id: z.string().length(24) }),
  body: z.object({ status: z.enum([GENERIC_STATUS.ACTIVE, GENERIC_STATUS.INACTIVE]) }),
});

export const updateLocationSettingsSchema = z.object({
  params: z.object({ id: z.string().length(24) }),
  body: z.object({ settings: z.record(z.unknown()) }),
});
