export const COOKIES = {
  REFRESH_TOKEN: 'refreshToken',
  SESSION_ID: 'sessionId',
} as const;

export const HEADERS = {
  REQUEST_ID: 'x-request-id',
  RAZORPAY_SIGNATURE: 'x-razorpay-signature',
  AUTHORIZATION: 'authorization',
} as const;

export const BEARER_PREFIX = 'Bearer ';

/** Must stay in sync: refresh cookie maxAge and refresh token DB expiry. */
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const GUEST_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_EXPIRY = '15m';
export const EMAIL_VERIFY_EXPIRY = '2d';

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;
export const DEFAULT_LOW_STOCK_THRESHOLD = 10;
export const RAZORPAY_MIN_AMOUNT_PAISE = 100;
export const MAX_AVATAR_BYTES = 1.5 * 1024 * 1024;
