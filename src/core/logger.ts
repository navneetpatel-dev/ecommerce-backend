import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { env } from '@config/env';

// logs directory path
const logsDir = path.join(process.cwd(), 'logs');

// dev format - colorized and pretty
const devFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      log += `\n${JSON.stringify(meta, null, 2)}`;
    }
    if (stack) {
      log += `\n${stack}`;
    }
    return log;
  })
);

// production format - json for log aggregators
const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// error logs - rotates daily, keeps 30 days, max 20mb per file
const errorFileTransport: DailyRotateFile = new DailyRotateFile({
  filename: path.join(logsDir, 'error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  level: 'error',
  maxSize: '20m',
  maxFiles: '30d',
  zippedArchive: true,
  format: prodFormat,
});

// combined logs - all levels, keeps 14 days, max 10mb
const combinedFileTransport: DailyRotateFile = new DailyRotateFile({
  filename: path.join(logsDir, 'combined-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '10m',
  maxFiles: '14d',
  zippedArchive: true,
  format: prodFormat,
});

// app logs - info level, keeps 7 days, max 10mb
const appFileTransport: DailyRotateFile = new DailyRotateFile({
  filename: path.join(logsDir, 'app-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  level: 'info',
  maxSize: '10m',
  maxFiles: '7d',
  zippedArchive: true,
  format: prodFormat,
});

// console transport - colorized in dev, json in prod
const consoleTransport = new winston.transports.Console({
  format: env.NODE_ENV === 'production' ? prodFormat : devFormat,
});

// main logger instance
export const logger = winston.createLogger({
  level: env.LOG_LEVEL || 'info',
  defaultMeta: { 
    service: 'ecommerce-backend',
    environment: env.NODE_ENV,
    hostname: process.env.HOSTNAME || 'unknown',
  },
  transports: [
    consoleTransport,
    errorFileTransport,
    combinedFileTransport,
    appFileTransport,
  ],
  // Handle uncaught exceptions and unhandled rejections
  exceptionHandlers: [
    new DailyRotateFile({
      filename: path.join(logsDir, 'exceptions-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
      zippedArchive: true,
    }),
  ],
  rejectionHandlers: [
    new DailyRotateFile({
      filename: path.join(logsDir, 'rejections-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
      zippedArchive: true,
    }),
  ],
  exitOnError: false,
});

// Helper function to log errors with full context
export const logError = (message: string, error: unknown, meta?: Record<string, unknown>) =>
  logger.error(message, {
    error: error instanceof Error ? { 
      message: error.message, 
      stack: error.stack,
      name: error.name,
    } : error,
    ...meta,
  });

// Log rotation events for monitoring
errorFileTransport.on('rotate', (oldFilename, newFilename) => {
  logger.info('Error log rotated', { oldFilename, newFilename });
});

combinedFileTransport.on('rotate', (oldFilename, newFilename) => {
  logger.info('Combined log rotated', { oldFilename, newFilename });
});

// Log when logger is initialized
logger.info('Logger initialized', {
  level: env.LOG_LEVEL || 'info',
  environment: env.NODE_ENV,
  logsDirectory: logsDir,
});
