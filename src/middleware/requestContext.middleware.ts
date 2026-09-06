import { Request, Response, NextFunction } from 'express';
import { requestContextStorage } from '@core/context/requestContext';

/** Establishes an AsyncLocalStorage context for the request so downstream code
 * (e.g. logAudit) can read per-request state like impersonation without every
 * call site threading it through explicitly. Mount after requestIdMiddleware. */
export const requestContextMiddleware = (req: Request, _res: Response, next: NextFunction) => {
  requestContextStorage.run({ requestId: req.requestId }, next);
};
