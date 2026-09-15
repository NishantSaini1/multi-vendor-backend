import { z } from 'zod';
import { TRANSACTION_TYPE, TRANSACTION_DIRECTION } from '../constants/enums';

const objectId = z.string().length(24);

export const listTransactionsQuerySchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    sort: z.string().optional(),
    vendorId: objectId.optional(),
    storeId: objectId.optional(),
    deliveryPartnerId: objectId.optional(),
    orderId: objectId.optional(),
    type: z.enum(Object.values(TRANSACTION_TYPE) as [string, ...string[]]).optional(),
    direction: z.enum(Object.values(TRANSACTION_DIRECTION) as [string, ...string[]]).optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
  }),
});
