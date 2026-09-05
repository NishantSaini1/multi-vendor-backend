import Redis from 'ioredis';
import { env } from './env';
import { logger } from '../utils/logger';

export const redisClient = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

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
