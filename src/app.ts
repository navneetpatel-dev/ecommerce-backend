import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import { env } from '@config/env';
import { sequelize } from '@config/db';
import { redisClient } from '@config/redis';
import { checkQueuesHealth } from '@config/queue';
import { readScheduledReportQueueDepth } from '@modules/reports/reportExportMetrics';
import { requestIdMiddleware } from '@middleware/requestId.middleware';
import { globalRateLimiter } from '@middleware/rateLimiter.middleware';
import { errorHandlerMiddleware } from '@middleware/errorHandler.middleware';
import { routes } from '@routes/index';
import {
  API_PREFIX,
  HEALTH_LIVE_PATH,
  HEALTH_PATH,
  WEBHOOKS_RAW_PATH,
} from '@core/constants/apiPaths';
import '@database/models';

const HEALTH_CHECK_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs);
    }),
  ]);
}

export const app = express();

app.use(requestIdMiddleware);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);
app.use(
  cors({
    origin: [
      env.CLIENT_URL,
      'http://localhost:5173',
      'http://localhost:3000',
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Page-Url'],
    exposedHeaders: ['Set-Cookie'],
    optionsSuccessStatus: 200,
  }),
);
app.use(compression());

app.use(WEBHOOKS_RAW_PATH, express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(mongoSanitize());

// Liveness — zero I/O; exempt from rate limiting (registered before limiter).
app.get(HEALTH_LIVE_PATH, (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Readiness — dependency checks with bounded timeouts.
app.get(HEALTH_PATH, async (_req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: env.NODE_ENV,
    services: {
      database: { status: 'down', message: '' },
      redis: { status: 'down', message: '' },
      queues: { status: 'down', message: '', queues: {} as Record<string, unknown> },
      scheduledReportQueue: { waiting: 0, active: 0, failed: 0 },
    },
  };

  try {
    await withTimeout(sequelize.authenticate(), HEALTH_CHECK_TIMEOUT_MS, 'Database');
    health.services.database = { status: 'up', message: 'Connected' };
  } catch (error) {
    health.services.database = {
      status: 'down',
      message: error instanceof Error ? error.message : 'Connection failed',
    };
    health.status = 'degraded';
  }

  try {
    const pong = await withTimeout(redisClient.ping(), HEALTH_CHECK_TIMEOUT_MS, 'Redis');
    health.services.redis = {
      status: pong === 'PONG' ? 'up' : 'down',
      message: pong === 'PONG' ? 'Connected' : 'Unexpected response',
    };
  } catch (error) {
    health.services.redis = {
      status: 'down',
      message: error instanceof Error ? error.message : 'Connection failed',
    };
  }

  try {
    const queuesHealth = await withTimeout(
      checkQueuesHealth(),
      HEALTH_CHECK_TIMEOUT_MS,
      'Queue health',
    );
    health.services.queues = queuesHealth;
    health.services.scheduledReportQueue = await withTimeout(
      readScheduledReportQueueDepth(),
      HEALTH_CHECK_TIMEOUT_MS,
      'Scheduled report queue depth',
    );
  } catch (error) {
    health.services.queues = {
      status: 'down',
      message: error instanceof Error ? error.message : 'Connection failed',
      queues: {},
    };
    health.services.scheduledReportQueue = { waiting: 0, active: 0, failed: 0 };
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

app.use(globalRateLimiter);

app.use(API_PREFIX, routes);

app.use(errorHandlerMiddleware);
