import { z } from 'zod';

export const geocodeSearchSchema = z.object({
  query: z.object({
    q: z.string().trim().min(2),
  }),
});

export const geocodeReverseSchema = z.object({
  query: z.object({
    latitude: z.string().refine((v) => !Number.isNaN(Number(v)), 'latitude must be a number'),
    longitude: z.string().refine((v) => !Number.isNaN(Number(v)), 'longitude must be a number'),
  }),
});
