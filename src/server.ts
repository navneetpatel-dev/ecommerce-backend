import { app } from './app';
import { connectDatabase } from '@config/db';
import { connectRedis } from '@config/redis';
import { connectQueues, closeQueues } from '@config/queue';
import { logger } from '@core/logger';
import { env } from '@config/env';

async function bootstrap() {
  await connectDatabase();
  logger.info('Database connected');

  const redisOk = await connectRedis();
  if (redisOk) {
    logger.info('Redis connected');
    try {
      await connectQueues();
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

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(async () => {
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
