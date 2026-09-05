import { retryFailedPushes } from '../services/notification.service';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export async function runNotificationRetry(): Promise<{ retried: number; succeeded: number }> {
  const result = await retryFailedPushes(env.NOTIFICATION_RETRY_MAX_ATTEMPTS);
  if (result.retried > 0) {
    logger.info(result, 'Notification retry sweep completed');
  }
  return result;
}
