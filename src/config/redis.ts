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
});

if (!isRedisConfigured) {
  logger.warn('REDIS_URL is not set; rate limiting uses in-memory storage and OTP/password reset are unavailable');
}

redisClient.on('connect', () => logger.info('Redis connected'));
redisClient.on('error', (err) => logger.error({ err }, 'Redis connection error'));

export async function isRedisConnected(): Promise<boolean> {
  try {
    const pong = await redisClient.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}
