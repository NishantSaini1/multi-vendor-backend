import { z } from 'zod';
import { DELIVERY_STATUS } from '../constants/deliveryStatus';

const objectId = z.string().length(24);

export const deliveryIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const updateDeliveryStatusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    status: z.enum([
      DELIVERY_STATUS.ACCEPTED,
      DELIVERY_STATUS.ARRIVED_AT_PICKUP,
      DELIVERY_STATUS.PICKED_UP,
      DELIVERY_STATUS.OUT_FOR_DELIVERY,
      DELIVERY_STATUS.DELIVERED,
      DELIVERY_STATUS.CANCELLED,
      DELIVERY_STATUS.FAILED,
    ]),
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
