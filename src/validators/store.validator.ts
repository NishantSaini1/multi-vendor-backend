import { z } from 'zod';
import { phoneSchema } from './auth.validator';
import { STORE_STATUS, APPROVAL_STATUS } from '../constants/enums';

const objectId = z.string().length(24);

export const createStoreSchema = z.object({
  body: z.object({
    locationId: objectId,
    name: z.string().min(2),
    managerName: z.string().min(2),
    phone: phoneSchema,
    email: z.string().email().optional(),
    address: z.string().min(3),
    latitude: z.number(),
    longitude: z.number(),
    openingTime: z.string().default('09:00'),
    closingTime: z.string().default('22:00'),
  }),
});

export const updateStoreSchema = z.object({
  params: z.object({ id: objectId }),
  body: createStoreSchema.shape.body.partial(),
});

export const storeIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const updateStoreStatusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ status: z.enum([STORE_STATUS.ACTIVE, STORE_STATUS.INACTIVE, STORE_STATUS.SUSPENDED]) }),
});

export const storeIdOnlyParamSchema = z.object({
  params: z.object({ storeId: objectId }),
});

export const createStoreDocumentSchema = z.object({
  params: z.object({ storeId: objectId }),
  body: z.object({
    type: z.string().min(2),
    fileUrl: z.string().url(),
  }),
});

export const storeDocumentParamsSchema = z.object({
  params: z.object({ storeId: objectId, documentId: objectId }),
});

export const updateStoreDocumentSchema = z.object({
  params: z.object({ storeId: objectId, documentId: objectId }),
  body: z.object({
    status: z.enum([APPROVAL_STATUS.PENDING, APPROVAL_STATUS.APPROVED, APPROVAL_STATUS.REJECTED]).optional(),
    remarks: z.string().optional(),
  }),
});
