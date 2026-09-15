/**
 * Dedicated worker process — run alongside the API in production if you prefer
 * isolating email/scheduler load from HTTP: `npm run worker`
 */
import { connectDatabase } from '@config/db';
import { connectRedis } from '@config/redis';
import { connectQueues, closeQueues, areQueuesReady } from '@config/queue';
import { logger } from '@core/logger';
import { env } from '@config/env';
import { couponsService } from '@modules/coupons/coupons.service';
import { startBackgroundWorkers, stopBackgroundWorkers } from '@jobs/index';
import '@database/models';
import '@modules/reports/engine/reportExportSource';

const COUPON_ALERT_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function bootstrap() {
  await connectDatabase();
  const redisOk = await connectRedis();
  if (!redisOk) {
    throw new Error('Redis required for worker process');
  }
  await connectQueues();
  if (!areQueuesReady()) {
    throw new Error('BullMQ queues failed to connect');
  }
  await startBackgroundWorkers();
  logger.info('Background worker process ready');

  let couponAlertTimer: ReturnType<typeof setInterval> | undefined;
  if (!env.START_WORKERS_IN_API) {
    const runCouponAlerts = () => {
      void couponsService.notifyExpiringAndNearLimit().then(
        (result) => {
          if (result.notified > 0) {
            logger.info('Coupon alert job completed', result);
          }
        },
        (error) => {
          logger.warn('Coupon alert job failed', {
            error: error instanceof Error ? error.message : error,
          });
        },
      );
    };
    runCouponAlerts();
    couponAlertTimer = setInterval(runCouponAlerts, COUPON_ALERT_INTERVAL_MS);
  }

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — stopping workers`);
    if (couponAlertTimer) clearInterval(couponAlertTimer);
    await stopBackgroundWorkers();
    await closeQueues();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error('Worker bootstrap failed', err);
  process.exit(1);
});
