import { app } from './app';
import { connectDatabase } from '@config/db';
import { connectRedis } from '@config/redis';
import { connectQueues, closeQueues, areQueuesReady } from '@config/queue';
import { logger } from '@core/logger';
import { env } from '@config/env';
import { couponsService } from '@modules/coupons/coupons.service';
import { startBackgroundWorkers, stopBackgroundWorkers } from '@jobs/index';

const COUPON_ALERT_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function bootstrap() {
  await connectDatabase();
  logger.info('Database connected');

  const redisOk = await connectRedis();
  if (redisOk) {
    logger.info('Redis connected');
    try {
      await connectQueues();
      if (areQueuesReady()) {
        await startBackgroundWorkers();
      }
    } catch (error) {
      logger.warn('BullMQ queues unavailable — continuing without background jobs', {
        error: error instanceof Error ? error.message : error,
      });
    }
  } else {
    logger.warn('Skipping BullMQ queues because Redis is unavailable');
  }

  const server = app.listen(env.PORT, () => {
    logger.info(`Server running on port ${env.PORT}`, { env: env.NODE_ENV });
  });

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
  const couponAlertTimer = setInterval(runCouponAlerts, COUPON_ALERT_INTERVAL_MS);

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully`);
    clearInterval(couponAlertTimer);
    server.close(async () => {
      await stopBackgroundWorkers();
      await closeQueues();
      logger.info('HTTP server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error('Bootstrap failed', err);
  process.exit(1);
});
