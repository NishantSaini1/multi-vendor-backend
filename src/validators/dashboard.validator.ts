import { z } from 'zod';

export const dashboardOverviewQuerySchema = z.object({
  query: z.object({
    from: z.string().optional(),
    to: z.string().optional(),
  }),
});

export const ordersTrendQuerySchema = z.object({
  query: z.object({
    days: z.string().optional(),
  }),
});
