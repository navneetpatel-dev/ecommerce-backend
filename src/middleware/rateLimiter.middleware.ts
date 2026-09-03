import rateLimit, { type Options } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import Redis from 'ioredis';
import { env } from '@config/env';
import { AppError } from '@core/errors/AppError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { sendApiError } from '@core/http/sendApiError';

const isDev = env.NODE_ENV === 'development';
const rateLimitRedisClient = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: true,
  retryStrategy() {
    return null;
  },
});
rateLimitRedisClient.on('error', () => {});

function redisRateLimitStore(prefix: string) {
  return new RedisStore({
    prefix: `rate-limit:${prefix}:`,
    sendCommand: (...args: string[]) => rateLimitRedisClient.call(args[0]!, ...args.slice(1)) as Promise<any>,
  });
}

const jsonRateLimitHandler: Options['handler'] = (_req, res, _next, options) => {
  const message = options.message?.toString() || ERROR_MESSAGES.RATE_LIMITED;
  sendApiError(
    res,
    new AppError(message, options.statusCode, ERROR_CODES.RATE_LIMITED),
    options.statusCode,
  );
};

export const globalRateLimiter = rateLimit({
  store: redisRateLimitStore('global'),
  passOnStoreError: true,
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 2000 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
  message: ERROR_MESSAGES.RATE_LIMITED,
});

/** Failed auth attempts only (successful logins are skipped). */
export const authRateLimiter = rateLimit({
  store: redisRateLimitStore('auth'),
  passOnStoreError: true,
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 100 : 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
  message: ERROR_MESSAGES.AUTH_RATE_LIMITED,
});

/** OTP/email code issuance counts successful requests to prevent message flooding. */
export const otpRequestRateLimiter = rateLimit({
  store: redisRateLimitStore('otp-request'),
  passOnStoreError: true,
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 50 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
  message: ERROR_MESSAGES.OTP_REQUEST_RATE_LIMITED,
});

export const couponApplyRateLimiter = rateLimit({
  store: redisRateLimitStore('coupon'),
  passOnStoreError: true,
  windowMs: 60 * 1000,
  limit: isDev ? 60 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
  message: ERROR_MESSAGES.COUPON_APPLY_RATE_LIMITED,
});
