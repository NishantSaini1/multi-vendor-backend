import { z } from 'zod';
import { REFUND_STATUS, REFUND_TYPES } from '../constants/paymentStatus';

const objectId = z.string().length(24);

export const createRefundSchema = z.object({
  body: z
    .object({
      orderId: objectId,
      type: z.enum([REFUND_TYPES.FULL, REFUND_TYPES.PARTIAL]),
      amount: z.number().positive().optional(),
      reason: z.string().min(3),
    })
    .refine((data) => data.type !== REFUND_TYPES.PARTIAL || (data.amount && data.amount > 0), {
      message: 'amount is required for a PARTIAL refund',
      path: ['amount'],
    }),
});

export const refundIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const listRefundsQuerySchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    sort: z.string().optional(),
    orderId: objectId.optional(),
    customerId: objectId.optional(),
    status: z.enum(Object.values(REFUND_STATUS) as [string, ...string[]]).optional(),
  }),
});
