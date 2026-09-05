import { z } from 'zod';
import { DEVICE_TYPES } from '../constants/enums';

const objectId = z.string().length(24);

export const registerDeviceSchema = z.object({
  body: z.object({
    playerId: z.string().min(1),
    deviceType: z.enum(Object.values(DEVICE_TYPES) as [string, ...string[]]),
    deviceId: z.string().min(1),
  }),
});

export const deviceIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const notificationIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const listNotificationsQuerySchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    sort: z.string().optional(),
    isRead: z.enum(['true', 'false']).optional(),
  }),
});
