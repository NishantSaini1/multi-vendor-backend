import { z } from 'zod';
import { PAYMENT_STATUS } from '../constants/paymentStatus';

const objectId = z.string().length(24);

export const createRazorpayOrderSchema = z.object({
  body: z.object({ orderId: objectId }),
});

export const verifyPaymentSchema = z.object({
  body: z.object({
    orderId: objectId,
    razorpayOrderId: z.string().min(1),
    razorpayPaymentId: z.string().min(1),
    razorpaySignature: z.string().min(1),
  }),
});

export const paymentIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const listPaymentsQuerySchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    sort: z.string().optional(),
    orderId: objectId.optional(),
    customerId: objectId.optional(),
    status: z.enum(Object.values(PAYMENT_STATUS) as [string, ...string[]]).optional(),
  }),
});
