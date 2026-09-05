import { z } from 'zod';
import { CUSTOMER_STATUS } from '../constants/enums';

const objectId = z.string().length(24);

export const listCustomersQuerySchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    sort: z.string().optional(),
    status: z.enum(Object.values(CUSTOMER_STATUS) as [string, ...string[]]).optional(),
    search: z.string().optional(),
  }),
});

export const updateCustomerSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    profileImage: z.string().url().optional(),
  }),
});

export const customerIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const updateCustomerStatusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ status: z.enum([CUSTOMER_STATUS.ACTIVE, CUSTOMER_STATUS.BLOCKED]) }),
});
