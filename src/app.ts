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
import { requestIdMiddleware } from '@middleware/requestId.middleware';
import { globalRateLimiter } from '@middleware/rateLimiter.middleware';
import { errorHandlerMiddleware } from '@middleware/errorHandler.middleware';
import { routes } from '@routes/index';
import { API_PREFIX, HEALTH_PATH, WEBHOOKS_RAW_PATH } from '@core/constants/apiPaths';
import '@database/models';

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

app.use(globalRateLimiter);

// health check endpoint
app.get(HEALTH_PATH, async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: env.NODE_ENV,
    services: {
      database: { status: 'down', message: '' },
      redis: { status: 'down', message: '' },
      queues: { status: 'down', message: '', queues: {} },
    },
  };

  // check db connection
  try {
    await sequelize.authenticate();
    health.services.database = { status: 'up', message: 'Connected' };
  } catch (error) {
    health.services.database = { 
      status: 'down', 
      message: error instanceof Error ? error.message : 'Connection failed' 
    };
    health.status = 'degraded';
  }

  // check redis
  try {
    const pong = await redisClient.ping();
    health.services.redis = { 
      status: pong === 'PONG' ? 'up' : 'down', 
      message: pong === 'PONG' ? 'Connected' : 'Unexpected response' 
    };
  } catch (error) {
    health.services.redis = { 
      status: 'down', 
      message: error instanceof Error ? error.message : 'Connection failed' 
    };
    // redis is optional, don't fail health check
  }

  // check queue health
  try {
    const queuesHealth = await checkQueuesHealth();
    health.services.queues = queuesHealth;
  } catch (error) {
    health.services.queues = {
      status: 'down',
      message: error instanceof Error ? error.message : 'Connection failed',
      queues: {},
    };
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

app.use(API_PREFIX, routes);

app.use(errorHandlerMiddleware);
