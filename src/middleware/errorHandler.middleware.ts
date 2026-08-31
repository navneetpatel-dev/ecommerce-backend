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
