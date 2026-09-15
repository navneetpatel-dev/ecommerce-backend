import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { validate } from '@middleware/validate.middleware';
import { CreateExportJobSchema } from './exports.dto';
import { EXPORT_JOB_RATE_LIMIT_PER_MIN } from './exports.constants';
import * as exportsController from './exports.controller';
import { AppError } from '@core/errors';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { asyncHandler } from '@core/http/asyncHandler';
import { redisClient, withRedis } from '@config/redis';

const RATE_KEY_PREFIX = 'export-job:rate:';

async function redisIncrWithTtl(key: string, ttlSec: number): Promise<number | null> {
  const count = await withRedis(async () => {
    const value = await redisClient.incr(key);
    if (value === 1) await redisClient.expire(key, ttlSec);
    return value;
  });
  return count;
}

/** Per-user limiter — `rateLimiter.middleware.ts` has no `{ windowMs, max }` factory (only named IP limiters). */
async function assertExportRateLimit(userId: string): Promise<void> {
  const rateKey = `${RATE_KEY_PREFIX}${userId}`;
  const count = await redisIncrWithTtl(rateKey, 60);
  if (count == null) return;
  if (count > EXPORT_JOB_RATE_LIMIT_PER_MIN) {
    throw new AppError(
      ERROR_MESSAGES.EXPORT_RATE_LIMITED,
      429,
      ERROR_CODES.RATE_LIMITED,
      { retryAfterSec: 60 },
    );
  }
}

const exportJobRateGuard = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      next();
      return;
    }
    await assertExportRateLimit(req.user.id);
    next();
  },
);

const router = Router();

router.post(
  '/',
  authenticate,
  exportJobRateGuard,
  validate(CreateExportJobSchema, 'body'),
  exportsController.createExport,
);
router.get('/', authenticate, exportsController.listExports);
router.get('/:jobId', authenticate, exportsController.getExport);
router.get('/:jobId/download', authenticate, exportsController.downloadExport);
router.delete('/:jobId', authenticate, exportsController.cancelExport);
router.post('/:jobId/ack', authenticate, exportsController.acknowledgeExport);

export default router;
