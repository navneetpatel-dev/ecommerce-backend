import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { HEADERS } from '@core/constants/http';

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction) => {
  req.requestId = (req.headers[HEADERS.REQUEST_ID] as string) ?? randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};
