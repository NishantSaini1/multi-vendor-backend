import { z } from 'zod';
import { phoneSchema, passwordSchema } from './auth.validator';
import { VENDOR_STATUS, APPROVAL_STATUS, DISCOUNT_TYPES, DAYS_OF_WEEK } from '../constants/enums';

const objectId = z.string().length(24);

const businessHoursDaySchema = z.object({
  day: z.enum(Object.values(DAYS_OF_WEEK) as [string, ...string[]]),
  openTime: z.string().optional(),
  closeTime: z.string().optional(),
  isClosed: z.boolean().default(false),
});

const businessHoursSchema = z.object({
  weeklySchedule: z.array(businessHoursDaySchema).default([]),
  holidays: z.array(z.string()).default([]),
});

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
    vendorTypeIds: z.array(objectId).min(1),
    gstNumber: z.string().optional(),
    fssaiNumber: z.string().optional(),
    panNumber: z.string().optional(),
    logo: z.string().optional(),
    coverImage: z.string().optional(),
    businessHours: businessHoursSchema.optional(),
    // Optional — when both are supplied, a VENDOR-level Commission rule is
    // created for this vendor in the same step (see vendor.service.ts).
    commissionType: z.enum(Object.values(DISCOUNT_TYPES) as [string, ...string[]]).optional(),
    commissionValue: z.number().min(0).optional(),
  }),
});

export const updateVendorSchema = z.object({
  params: z.object({ id: objectId }),
  body: createVendorSchema.shape.body
    .omit({ password: true, commissionType: true, commissionValue: true })
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
