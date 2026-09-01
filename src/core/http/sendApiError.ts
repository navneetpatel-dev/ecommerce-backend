import type { Response } from 'express';
import type { AppError } from '@core/errors';
import { toPublicErrorBody } from '@core/http/publicError';

/** Send a sanitized API error envelope (same shape as errorHandler.middleware). */
export function sendApiError(res: Response, err: AppError, statusCode?: number) {
  res.status(statusCode ?? err.statusCode).json({
    success: false,
    error: toPublicErrorBody(err),
  });
}
