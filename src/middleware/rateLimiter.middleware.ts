import rateLimit, { type Options } from 'express-rate-limit';
import { env } from '@config/env';
import { AppError } from '@core/errors/AppError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { sendApiError } from '@core/http/sendApiError';

const isDev = env.NODE_ENV === 'development';

const jsonRateLimitHandler: Options['handler'] = (_req, res, _next, options) => {
  const message = options.message?.toString() || ERROR_MESSAGES.RATE_LIMITED;
  sendApiError(
    res,
    new AppError(message, options.statusCode, ERROR_CODES.RATE_LIMITED),
    options.statusCode,
  );
};

export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 2000 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
  message: ERROR_MESSAGES.RATE_LIMITED,
});

/** Failed auth attempts only (successful logins are skipped). */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 100 : 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
  message: ERROR_MESSAGES.AUTH_RATE_LIMITED,
});

export const couponApplyRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: isDev ? 60 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
  message: ERROR_MESSAGES.COUPON_APPLY_RATE_LIMITED,
});
