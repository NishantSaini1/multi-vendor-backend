import Redis from 'ioredis';
import { env } from './env';
import { logger } from '../utils/logger';

// In production the localhost default never points at a real server, so
// treat a missing REDIS_URL as "no Redis": don't connect at boot (avoids an
// endless reconnect/error loop) and let callers like the rate limiters fall
// back to in-memory state. Features that truly need Redis (OTP, password
// reset, partner geo) will still fail until REDIS_URL is set.
export const isRedisConfigured = Boolean(process.env.REDIS_URL) || !env.isProduction;

export const redisClient = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: !isRedisConfigured,
  // In production, fail commands immediately while disconnected instead of
  // queueing them through ~12s of retries (which made admin login hang and
  // 500). Dev/test keep the queue so calls made right after import wait for
  // the initial connection.
  enableOfflineQueue: !env.isProduction,
  // Back off reconnects up to 30s rather than hammering an absent server.
  retryStrategy: (times) => Math.min(times * 1000, 30_000),
});

if (!isRedisConfigured) {
  logger.warn('REDIS_URL is not set; rate limiting uses in-memory storage and OTP/password reset are unavailable');
}

// Log a connection failure once per outage, not on every reconnect attempt.
let redisErrorLogged = false;
redisClient.on('ready', () => {
  redisErrorLogged = false;
  logger.info('Redis connected');
});
redisClient.on('error', (err) => {
  if (redisErrorLogged) return;
  redisErrorLogged = true;
  logger.error({ err }, 'Redis connection error (further errors suppressed until it reconnects)');
});

export async function isRedisConnected(): Promise<boolean> {
  try {
    const pong = await redisClient.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}
