import { z } from 'zod';
import { phoneSchema, passwordSchema } from './auth.validator';
import { STORE_STATUS, APPROVAL_STATUS } from '../constants/enums';

const objectId = z.string().length(24);

export const createStoreSchema = z.object({
  body: z.object({
    locationId: objectId,
    storeTypeIds: z.array(objectId).min(1, 'Select at least one store type'),
    name: z.string().min(2),
    managerName: z.string().min(2),
    phone: phoneSchema,
    email: z.string().email().optional(),
    password: passwordSchema,
    address: z.string().min(3),
    latitude: z.number(),
    longitude: z.number(),
    openingTime: z.string().default('09:00'),
    closingTime: z.string().default('22:00'),
  }),
});

// password stays in the update body (unlike locationId/deliveryZoneId,
// which are never client-settable post-creation) — omitted entirely, it
// simply becomes optional, so an admin's "Reset Password" field on the
// store edit form actually reaches the service. See store.service.ts's
// updateStore, which hashes it before saving, same as createStore.
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

export const rejectStoreSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ reason: z.string().min(3) }),
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
