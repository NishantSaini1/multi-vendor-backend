import { z } from 'zod';
import { ADMIN_ROLE_LIST } from '../constants/roles';
import { CUSTOMER_STATUS } from '../constants/enums';
import { passwordSchema } from './auth.validator';

const objectId = z.string().length(24);

export const createAdminUserSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1),
    email: z.string().trim().email(),
    password: passwordSchema,
    role: z.enum(ADMIN_ROLE_LIST as [string, ...string[]]),
    locationIds: z.array(objectId).default([]),
  }),
});

export const adminUserIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const updateAdminUserSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    name: z.string().trim().min(1).optional(),
    email: z.string().trim().email().optional(),
    role: z.enum(ADMIN_ROLE_LIST as [string, ...string[]]).optional(),
    locationIds: z.array(objectId).optional(),
    profileImage: z.string().optional(),
  }),
});

export const updateAdminUserStatusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ status: z.enum(Object.values(CUSTOMER_STATUS) as [string, ...string[]]) }),
});

export const resetAdminUserPasswordSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ newPassword: passwordSchema }),
});

export const listAdminUsersQuerySchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    sort: z.string().optional(),
    role: z.enum(ADMIN_ROLE_LIST as [string, ...string[]]).optional(),
    status: z.enum(Object.values(CUSTOMER_STATUS) as [string, ...string[]]).optional(),
    locationId: objectId.optional(),
  }),
});
