import { Request } from 'express';
import { DeviceInfo } from '../services/token.service';

export function extractDeviceInfo(req: Request): DeviceInfo {
  return {
    deviceId: (req.body?.deviceId as string) || (req.headers['x-device-id'] as string) || undefined,
    deviceType: (req.body?.deviceType as string) || (req.headers['x-device-type'] as string) || undefined,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  };
}
