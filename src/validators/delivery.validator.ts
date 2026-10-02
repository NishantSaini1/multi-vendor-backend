import { z } from 'zod';
import { DELIVERY_STATUS } from '../constants/deliveryStatus';

const objectId = z.string().length(24);

export const deliveryIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const updateDeliveryStatusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    // PICKED_UP and DELIVERED are intentionally excluded — they require
    // OTP + image proof via the verify-pickup / verify-delivery endpoints.
    status: z.enum([
      DELIVERY_STATUS.ARRIVED_AT_VENDOR,
      DELIVERY_STATUS.OUT_FOR_DELIVERY,
      DELIVERY_STATUS.ARRIVED_AT_CUSTOMER,
      DELIVERY_STATUS.CANCELLED,
      DELIVERY_STATUS.FAILED,
    ]),
    cashCollected: z.boolean().optional(),
  }),
});

export const verifyPickupSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    otp: z.string().min(4).max(8),
    latitude: z.string().regex(/^-?\d+(\.\d+)?$/),
    longitude: z.string().regex(/^-?\d+(\.\d+)?$/),
  }),
});

export const verifyDeliverySchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    otp: z.string().min(4).max(8),
    latitude: z.string().regex(/^-?\d+(\.\d+)?$/),
    longitude: z.string().regex(/^-?\d+(\.\d+)?$/),
    cashCollected: z.union([z.boolean(), z.literal('true'), z.literal('false')]).optional(),
  }),
});

export const listDeliveriesQuerySchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    sort: z.string().optional(),
    status: z.string().optional(),
    deliveryPartnerId: objectId.optional(),
    orderId: objectId.optional(),
  }),
});

export const assignDeliverySchema = z.object({
  body: z.object({
    orderId: objectId,
    deliveryPartnerId: objectId,
  }),
});

export const reassignDeliverySchema = z.object({
  body: z.object({
    orderId: objectId,
    deliveryPartnerId: objectId,
    reason: z.string().min(3),
  }),
});
