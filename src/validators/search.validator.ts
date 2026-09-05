import { z } from 'zod';
import { BUSINESS_TYPES } from '../constants/orderStatus';

const objectId = z.string().length(24);

export const searchQuerySchema = z.object({
  query: z.object({
    q: z.string().trim().min(2),
    locationId: objectId.optional(),
    businessType: z.enum([BUSINESS_TYPES.FOOD, BUSINESS_TYPES.INSTAMART]).optional(),
  }),
});
