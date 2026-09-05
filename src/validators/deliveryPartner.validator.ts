import { z } from 'zod';
import { phoneSchema, passwordSchema } from './auth.validator';
import { DELIVERY_PARTNER_STATUS, DELIVERY_PARTNER_AVAILABILITY } from '../constants/deliveryStatus';
import { APPROVAL_STATUS } from '../constants/enums';

const objectId = z.string().length(24);

export const createDeliveryPartnerSchema = z.object({
  body: z.object({
    locationId: objectId,
    name: z.string().min(2),
    phone: phoneSchema,
    email: z.string().email().optional(),
    password: passwordSchema,
  }),
});

export const updateDeliveryPartnerSchema = z.object({
  params: z.object({ id: objectId }),
  body: createDeliveryPartnerSchema.shape.body.omit({ password: true }).partial(),
});

export const deliveryPartnerIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const updateDeliveryPartnerStatusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    status: z.enum([
      DELIVERY_PARTNER_STATUS.PENDING,
      DELIVERY_PARTNER_STATUS.ACTIVE,
      DELIVERY_PARTNER_STATUS.SUSPENDED,
      DELIVERY_PARTNER_STATUS.BLOCKED,
    ]),
  }),
});

export const rejectDeliveryPartnerSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ reason: z.string().min(3) }),
});

export const updateAvailabilitySchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    availability: z.enum([
      DELIVERY_PARTNER_AVAILABILITY.OFFLINE,
      DELIVERY_PARTNER_AVAILABILITY.ONLINE,
      DELIVERY_PARTNER_AVAILABILITY.BUSY,
      DELIVERY_PARTNER_AVAILABILITY.ON_DELIVERY,
    ]),
  }),
});

export const updateLocationSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().nonnegative().optional(),
  }),
});

export const deliveryPartnerIdOnlyParamSchema = z.object({
  params: z.object({ deliveryPartnerId: objectId }),
});

export const createDeliveryPartnerDocumentSchema = z.object({
  params: z.object({ deliveryPartnerId: objectId }),
  body: z.object({
    type: z.string().min(2),
    fileUrl: z.string().url(),
  }),
});

export const deliveryPartnerDocumentParamsSchema = z.object({
  params: z.object({ deliveryPartnerId: objectId, documentId: objectId }),
});

export const updateDeliveryPartnerDocumentSchema = z.object({
  params: z.object({ deliveryPartnerId: objectId, documentId: objectId }),
  body: z.object({
    status: z.enum([APPROVAL_STATUS.PENDING, APPROVAL_STATUS.APPROVED, APPROVAL_STATUS.REJECTED]).optional(),
    remarks: z.string().optional(),
  }),
});

export const availablePartnersQuerySchema = z.object({
  query: z.object({
    locationId: objectId,
    latitude: z.string(),
    longitude: z.string(),
    radiusKm: z.string().optional(),
  }),
});
