import { z } from 'zod';
import { GENERIC_STATUS } from '../constants/enums';

const objectId = z.string().length(24);

const polygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
});

export const createDeliveryZoneSchema = z.object({
  body: z
    .object({
      locationId: objectId,
      name: z.string().min(2),
      polygon: polygonSchema.optional(),
      centerLatitude: z.number().optional(),
      centerLongitude: z.number().optional(),
      radius: z.number().positive().optional(),
      deliveryFee: z.number().min(0),
      freeDeliveryAbove: z.number().min(0).default(0),
      maxDistance: z.number().positive().default(10),
      estimatedDeliveryTime: z.number().positive().default(30),
    })
    .refine((data) => data.polygon || (data.centerLatitude !== undefined && data.centerLongitude !== undefined && data.radius), {
      message: 'Provide either a polygon or centerLatitude/centerLongitude/radius',
    }),
});

export const updateDeliveryZoneSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    name: z.string().min(2).optional(),
    polygon: polygonSchema.optional(),
    centerLatitude: z.number().optional(),
    centerLongitude: z.number().optional(),
    radius: z.number().positive().optional(),
    deliveryFee: z.number().min(0).optional(),
    freeDeliveryAbove: z.number().min(0).optional(),
    maxDistance: z.number().positive().optional(),
    estimatedDeliveryTime: z.number().positive().optional(),
  }),
});

export const deliveryZoneIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const updateDeliveryZoneStatusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ status: z.enum([GENERIC_STATUS.ACTIVE, GENERIC_STATUS.INACTIVE]) }),
});
