import cron from 'node-cron';
import { logger } from '../utils/logger';
import { runOrderTimeoutSweep } from './orderTimeout.job';
import { runNotificationRetry } from './notificationRetry.job';
import { runDailySettlementGeneration } from './settlementGeneration.job';

// OTP expiry itself is already handled by Redis TTL, so no cleanup job is
// needed for that piece — only the three below have real work to do.
// Wrapped so a thrown error inside a job never kills the process or the
// cron scheduler itself (each job's own logic already catches per-item
// failures internally; this is the outer safety net).
function safeRun(name: string, fn: () => Promise<unknown>): () => void {
  return () => {
    fn().catch((err) => logger.error({ err }, `Background job "${name}" failed`));
  };
}

export function registerJobs(): void {
  cron.schedule('*/5 * * * *', safeRun('orderTimeoutSweep', runOrderTimeoutSweep));
  cron.schedule('*/10 * * * *', safeRun('notificationRetry', runNotificationRetry));
  cron.schedule('0 1 * * *', safeRun('dailySettlementGeneration', runDailySettlementGeneration));

  logger.info(
    'Background jobs registered: orderTimeoutSweep (every 5m), notificationRetry (every 10m), dailySettlementGeneration (daily at 01:00)',
  );
}
