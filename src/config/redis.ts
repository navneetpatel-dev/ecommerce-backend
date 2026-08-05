import Redis from 'ioredis';
import { env } from './env';
import { logger } from '@core/logger';

export const redisClient = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  retryStrategy() {
    return null;
  },
  lazyConnect: true,
});

redisClient.on('error', () => {});

export async function connectRedis(): Promise<void> {
  try {
    await redisClient.connect();
  } catch (err) {
    logger.warn('Redis not available — continuing without cache', { error: (err as Error).message });
  }
}
