/**
 * Dedicated worker process — run alongside the API in production if you prefer
 * isolating email/scheduler load from HTTP: `npm run worker`
 */
import { connectDatabase } from '@config/db';
import { connectRedis } from '@config/redis';
import { connectQueues, closeQueues, areQueuesReady } from '@config/queue';
import { logger } from '@core/logger';
import { startBackgroundWorkers, stopBackgroundWorkers } from '@jobs/index';
import '@database/models';

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
  logger.info('Email worker process ready');

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — stopping workers`);
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
