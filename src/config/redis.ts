import Redis from 'ioredis';
import { env } from './env';
import { logger } from '@core/logger';

export const redisClient = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  retryStrategy() {
    return null;
  },
  lazyConnect: true,
  enableOfflineQueue: false,
});

redisClient.on('error', () => {});

export async function connectRedis(): Promise<boolean> {
  try {
    if (redisClient.status === 'wait' || redisClient.status === 'end') {
      await redisClient.connect();
    }
    const pong = await Promise.race([
      redisClient.ping(),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('Redis ping timeout')), 1500),
      ),
    ]);
    if (pong !== 'PONG') {
      throw new Error(`Unexpected redis response: ${pong}`);
    }
    return true;
  } catch (err) {
    logger.warn('Redis not available — continuing without cache', {
      error: (err as Error).message,
    });
    return false;
  }
}

const REDIS_OP_TIMEOUT_MS = 1_500;

/** Race Redis connect + command against a timeout; returns null on failure. */
export async function withRedis<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await Promise.race([
      (async () => {
        if (redisClient.status === 'wait' || redisClient.status === 'end') {
          await redisClient.connect();
        }
        return fn();
      })(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Redis operation timeout')), REDIS_OP_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  }
}
