import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { AppError } from '@core/errors';
import { logger, logError } from '@core/logger';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';

export const errorHandlerMiddleware: ErrorRequestHandler = (err: Error, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    logger.warn(err.message, { code: err.code, requestId: req.requestId });
    res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  logError('Unhandled error', err, { requestId: req.requestId });
  res.status(500).json({
    success: false,
    error: { code: ERROR_CODES.INTERNAL_ERROR, message: ERROR_MESSAGES.INTERNAL_ERROR },
  });
};
