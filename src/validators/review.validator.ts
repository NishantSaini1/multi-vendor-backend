import { z } from 'zod';
import { REVIEW_TARGET_TYPES, REVIEW_STATUS } from '../constants/enums';

const objectId = z.string().length(24);

export const createReviewSchema = z.object({
  body: z.object({
    orderId: objectId,
    targetType: z.enum(Object.values(REVIEW_TARGET_TYPES) as [string, ...string[]]),
    targetId: objectId,
    rating: z.number().int().min(1).max(5),
    comment: z.string().max(2000).optional(),
    images: z.array(z.string()).max(10).default([]),
  }),
});

export const reviewIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const updateReviewSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    rating: z.number().int().min(1).max(5).optional(),
    comment: z.string().max(2000).optional(),
    images: z.array(z.string()).max(10).optional(),
  }),
});

export const updateReviewStatusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ status: z.enum(Object.values(REVIEW_STATUS) as [string, ...string[]]) }),
});

export const listReviewsQuerySchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    sort: z.string().optional(),
    targetType: z.enum(Object.values(REVIEW_TARGET_TYPES) as [string, ...string[]]).optional(),
    targetId: objectId.optional(),
    customerId: objectId.optional(),
  }),
});
