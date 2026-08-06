import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { notificationsService } from './notifications.service';

export const listLogs = asyncHandler(async (_req: Request, res: Response) => {
  res.json(ok(await notificationsService.listLogs()));
});

export const createTest = asyncHandler(async (req: Request, res: Response) => {
  const log = await notificationsService.createTest(req.user!.id, req.body);
  res.status(201).json(ok(log));
});
