import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { ValidationError } from '@core/errors/ValidationError';

export const validate = (schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(new ValidationError(result.error.flatten()));
    }
    (req as unknown as Record<string, unknown>)[source] = result.data;
    next();
  };
};
