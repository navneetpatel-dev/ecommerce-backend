import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { AppError } from '@core/errors';
import { logError, unwrapRootError } from '@core/logger';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { toPublicErrorBody } from '@core/http/publicError';

export const errorHandlerMiddleware: ErrorRequestHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  if (err instanceof AppError) {
    const rootError = unwrapRootError(err);
    logError('API error', rootError, {
      code: err.code,
      statusCode: err.statusCode,
      publicMessage: err.message,
      details: err.details,
      requestId: req.requestId,
      path: req.path,
      method: req.method,
    });

    if (err.details && typeof err.details === 'object' && err.details !== null) {
      const retryAfter = (err.details as { retryAfterSec?: unknown }).retryAfterSec;
      if (typeof retryAfter === 'number' && retryAfter > 0) {
        res.setHeader('Retry-After', String(Math.ceil(retryAfter)));
      }
    }

    res.status(err.statusCode).json({
      success: false,
      error: toPublicErrorBody(err),
    });
    return;
  }

  if (isMalformedValue(err)) {
    // A non-UUID id (or other badly typed value) reached Postgres: the caller's
    // mistake, not a server fault.
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_ID', message: 'That id is not valid.' },
    });
    return;
  }

  logError('Unhandled error', err, {
    requestId: req.requestId,
    path: req.path,
    method: req.method,
  });

  res.status(500).json({
    success: false,
    error: {
      code: ERROR_CODES.INTERNAL_ERROR,
      message: ERROR_MESSAGES.INTERNAL_ERROR,
    },
  });
};

/** Postgres 22P02 (invalid_text_representation), e.g. `GET /api/orders/abc`. */
function isMalformedValue(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; current && depth < 4; depth += 1) {
    const candidate = current as { code?: unknown; parent?: unknown; original?: unknown; cause?: unknown };
    if (candidate.code === '22P02') return true;
    current = candidate.parent ?? candidate.original ?? candidate.cause;
  }
  return false;
}
