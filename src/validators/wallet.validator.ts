import { z } from 'zod';

const objectId = z.string().length(24);

export const walletCustomerParamSchema = z.object({
  params: z.object({ customerId: objectId }),
});

export const listWalletTransactionsQuerySchema = z.object({
  params: z.object({ customerId: objectId }),
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    sort: z.string().optional(),
  }),
});

export const adjustWalletSchema = z.object({
  params: z.object({ customerId: objectId }),
  body: z.object({
    amount: z.number().positive(),
    type: z.enum(['CREDIT', 'DEBIT', 'ADJUSTMENT', 'CASHBACK']),
    note: z.string().min(3),
  }),
});
