import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { notificationsService } from './notifications.service';
import { pushService } from './push.service';
import { AppError } from '@core/errors';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';

export const listLogs = asyncHandler(async (_req: Request, res: Response) => {
  res.json(ok(await notificationsService.listLogs()));
});

export const createTest = asyncHandler(async (req: Request, res: Response) => {
  const log = await notificationsService.createTest(req.user!.id, req.body);
  res.status(201).json(ok(log));
});

export const pushPublicKey = asyncHandler(async (_req: Request, res: Response) => {
  const publicKey = pushService.publicKey();
  if (!publicKey) {
    throw new AppError(ERROR_MESSAGES.PUSH_NOT_CONFIGURED, 503, ERROR_CODES.CONFIG_ERROR);
  }
  res.json(ok({ publicKey }));
});

export const subscribePush = asyncHandler(async (req: Request, res: Response) => {
  const subscription = await pushService.subscribe(
    req.user!.id,
    req.body,
    req.header('user-agent'),
  );
  res.status(201).json(ok(subscription));
});

export const unsubscribePush = asyncHandler(async (req: Request, res: Response) => {
  await pushService.unsubscribe(req.user!.id, String(req.query.endpoint));
  res.status(204).send();
});
