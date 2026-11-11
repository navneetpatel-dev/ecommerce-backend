import crypto from 'crypto';
import { redisClient, withRedis } from '@config/redis';
import { AppError } from '@core/errors/AppError';

const WINDOW_SECONDS = 30;
export const DUPLICATE_SUBMISSION_MESSAGE = 'This was already sent a moment ago, so it was not sent again.';

/**
 * Stops a double click (or a retried request) from creating the same record
 * twice. The first request with a given body claims a short-lived key; an
 * identical one from the same user within 30 seconds gets 409. If Redis is
 * unavailable the request goes through, as it did before.
 */
export async function assertNotDuplicateSubmission(scope: string, userId: string, body: unknown): Promise<void> {
  const digest = crypto.createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex').slice(0, 32);
  const key = `submit:${scope}:${userId}:${digest}`;
  const claimed = await withRedis(() => redisClient.set(key, '1', 'EX', WINDOW_SECONDS, 'NX'));
  if (claimed === null && (await withRedis(() => redisClient.exists(key))) === 1) {
    throw new AppError(DUPLICATE_SUBMISSION_MESSAGE, 409, 'DUPLICATE_SUBMISSION');
  }
}
