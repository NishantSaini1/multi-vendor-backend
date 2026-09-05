import { z } from 'zod';
import { DELIVERY_ISSUE_TYPES, DELIVERY_ISSUE_STATUS } from '../constants/deliveryStatus';

const objectId = z.string().length(24);

export const createDeliveryIssueSchema = z.object({
  body: z.object({
    deliveryId: objectId,
    type: z.enum(Object.values(DELIVERY_ISSUE_TYPES) as [string, ...string[]]),
    description: z.string().max(2000).optional(),
    images: z.array(z.string()).max(10).default([]),
  }),
});

export const deliveryIssueIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const updateDeliveryIssueStatusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      status: z.enum(Object.values(DELIVERY_ISSUE_STATUS) as [string, ...string[]]),
      resolutionNote: z.string().min(1).optional(),
    })
    .refine(
      (data) => !(data.status === DELIVERY_ISSUE_STATUS.RESOLVED || data.status === DELIVERY_ISSUE_STATUS.CLOSED) || !!data.resolutionNote,
      { message: 'resolutionNote is required when resolving or closing an issue', path: ['resolutionNote'] },
    ),
});

export const listDeliveryIssuesQuerySchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    sort: z.string().optional(),
    status: z.enum(Object.values(DELIVERY_ISSUE_STATUS) as [string, ...string[]]).optional(),
    type: z.enum(Object.values(DELIVERY_ISSUE_TYPES) as [string, ...string[]]).optional(),
    deliveryId: objectId.optional(),
  }),
});
