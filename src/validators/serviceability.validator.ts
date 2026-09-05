import { z } from 'zod';
import { BUSINESS_TYPES } from '../constants/orderStatus';

export const checkServiceabilitySchema = z.object({
  body: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    businessType: z.enum([BUSINESS_TYPES.FOOD, BUSINESS_TYPES.INSTAMART]),
  }),
});
