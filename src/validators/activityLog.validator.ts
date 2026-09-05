import { z } from 'zod';

const objectId = z.string().length(24);

export const listActivityLogsQuerySchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    sort: z.string().optional(),
    userId: objectId.optional(),
    module: z.string().optional(),
    entityType: z.string().optional(),
    action: z.string().optional(),
    locationId: objectId.optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
});
