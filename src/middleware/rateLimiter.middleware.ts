import rateLimit, { type Options } from 'express-rate-limit';
import { env } from '@config/env';

const isDev = env.NODE_ENV === 'development';

const jsonRateLimitHandler: Options['handler'] = (_req, res, _next, options) => {
  res.status(options.statusCode).json({
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: options.message?.toString() || 'Too many requests, please try again later.',
    },
  });
};

export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 2000 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
  message: 'Too many requests, please try again later.',
});

/** Failed auth attempts only (successful logins are skipped). */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 100 : 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
  message: 'Too many login attempts. Please wait a few minutes and try again.',
});

export const couponApplyRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: isDev ? 60 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
  message: 'Too many coupon attempts. Please try again shortly.',
});
