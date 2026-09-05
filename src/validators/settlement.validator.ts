import { z } from 'zod';
import { SETTLEMENT_PAYEE_TYPES } from '../models/Settlement';
import { SETTLEMENT_STATUS } from '../constants/paymentStatus';

const objectId = z.string().length(24);
const payeeType = z.enum(Object.values(SETTLEMENT_PAYEE_TYPES) as [string, ...string[]]);

export const generateSettlementsSchema = z.object({
  body: z.object({
    payeeType,
    periodStart: z.string().min(1),
    periodEnd: z.string().min(1),
    locationId: objectId.optional(),
  }),
});

export const settlementIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const updateSettlementAdjustmentsSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ adjustments: z.number() }),
});

export const paySettlementSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ transactionReference: z.string().min(1) }),
});

export const listSettlementsQuerySchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    sort: z.string().optional(),
    payeeType: payeeType.optional(),
    payeeId: objectId.optional(),
    locationId: objectId.optional(),
    status: z.enum(Object.values(SETTLEMENT_STATUS) as [string, ...string[]]).optional(),
  }),
});
