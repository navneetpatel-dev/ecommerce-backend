import type { Request, Response, NextFunction } from 'express';
import { AppError } from '@core/errors';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { asyncHandler } from '@core/http/asyncHandler';
import { redisClient, withRedis } from '@config/redis';
import { reportExportConfig } from './reportExportConfig';

const RATE_KEY_PREFIX = 'report-export:rate:';

async function redisIncrWithTtl(key: string, ttlSec: number): Promise<number | null> {
  const count = await withRedis(async () => {
    const value = await redisClient.incr(key);
    if (value === 1) await redisClient.expire(key, ttlSec);
    return value;
  });
  return count;
}

export async function assertReportExportRateLimit(userId: string): Promise<void> {
  const rateKey = `${RATE_KEY_PREFIX}${userId}`;
  const count = await redisIncrWithTtl(rateKey, 60);
  if (count == null) return;
  if (count > reportExportConfig.rateLimitPerMin) {
    throw new AppError(
      ERROR_MESSAGES.REPORT_EXPORT_RATE_LIMITED,
      429,
      ERROR_CODES.RATE_LIMITED,
      { retryAfterSec: 60 },
    );
  }
}

/** Rate-limit export-capable routes (non-json format). */
export const reportExportGuard = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      next();
      return;
    }
    const format = String(req.query.format ?? 'json');
    if (format === 'json') {
      next();
      return;
    }
    await assertReportExportRateLimit(req.user.id);
    next();
  },
);
