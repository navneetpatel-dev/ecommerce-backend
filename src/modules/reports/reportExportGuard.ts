import type { Request, Response, NextFunction } from 'express';
import { AppError } from '@core/errors';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { asyncHandler } from '@core/http/asyncHandler';
import { redisClient } from '@config/redis';
import { reportExportConfig } from './reportExportConfig';

const RATE_KEY_PREFIX = 'report-export:rate:';

async function redisIncrWithTtl(key: string, ttlSec: number): Promise<number | null> {
  try {
    if (redisClient.status === 'wait' || redisClient.status === 'end') {
      await redisClient.connect();
    }
    const count = await redisClient.incr(key);
    if (count === 1) await redisClient.expire(key, ttlSec);
    return count;
  } catch {
    return null;
  }
}

export async function assertReportExportRateLimit(userId: string): Promise<void> {
  const rateKey = `${RATE_KEY_PREFIX}${userId}`;
  const count = await redisIncrWithTtl(rateKey, 60);
  if (count == null) {
    if (reportExportConfig.isProduction) {
      throw new AppError(
        ERROR_MESSAGES.REPORT_EXPORT_QUEUE_UNAVAILABLE,
        503,
        ERROR_CODES.REPORT_EXPORT_QUEUE_UNAVAILABLE,
      );
    }
    return;
  }
  if (count > reportExportConfig.rateLimitPerMin) {
    throw new AppError(
      ERROR_MESSAGES.REPORT_EXPORT_RATE_LIMITED,
      429,
      ERROR_CODES.RATE_LIMITED,
      { retryAfterSec: 60 },
    );
  }
}

/** Rate-limit export-capable routes. Concurrent pending cap is applied after dedup in runExport. */
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
