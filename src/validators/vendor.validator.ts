import { z } from 'zod';
import { phoneSchema, passwordSchema } from './auth.validator';
import { VENDOR_STATUS, APPROVAL_STATUS } from '../constants/enums';

const objectId = z.string().length(24);

export const createVendorSchema = z.object({
  body: z.object({
    locationId: objectId,
    restaurantName: z.string().min(2),
    description: z.string().optional(),
    ownerName: z.string().min(2),
    phone: phoneSchema,
    email: z.string().email().optional(),
    password: passwordSchema,
    address: z.string().min(3),
    latitude: z.number(),
    longitude: z.number(),
    serviceRadius: z.number().positive().default(5),
    cuisines: z.array(z.string()).default([]),
    gstNumber: z.string().optional(),
    fssaiNumber: z.string().optional(),
    panNumber: z.string().optional(),
    logo: z.string().optional(),
    coverImage: z.string().optional(),
  }),
});

export const updateVendorSchema = z.object({
  params: z.object({ id: objectId }),
  body: createVendorSchema.shape.body
    .omit({ password: true })
    .extend({
      isOpen: z.boolean().optional(),
      temporaryClosure: z
        .object({ reopensAt: z.string().optional(), reason: z.string().optional() })
        .nullable()
        .optional(),
    })
    .partial(),
});

export const vendorIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const updateVendorStatusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ status: z.enum([VENDOR_STATUS.ACTIVE, VENDOR_STATUS.INACTIVE, VENDOR_STATUS.SUSPENDED]) }),
});

export const rejectVendorSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ reason: z.string().min(3) }),
});

export const listVendorsQuerySchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    sort: z.string().optional(),
    locationId: objectId.optional(),
    status: z.enum(Object.values(VENDOR_STATUS) as [string, ...string[]]).optional(),
    approvalStatus: z.enum(Object.values(APPROVAL_STATUS) as [string, ...string[]]).optional(),
    search: z.string().optional(),
  }),
});

export const vendorIdOnlyParamSchema = z.object({
  params: z.object({ vendorId: objectId }),
});

export const createVendorDocumentSchema = z.object({
  params: z.object({ vendorId: objectId }),
  body: z.object({
    type: z.string().min(2),
    fileUrl: z.string().url(),
  }),
});

export const vendorDocumentParamsSchema = z.object({
  params: z.object({ vendorId: objectId, documentId: objectId }),
});

export const updateVendorDocumentSchema = z.object({
  params: z.object({ vendorId: objectId, documentId: objectId }),
  body: z.object({
    status: z.enum([APPROVAL_STATUS.PENDING, APPROVAL_STATUS.APPROVED, APPROVAL_STATUS.REJECTED]).optional(),
    remarks: z.string().optional(),
  }),
});
