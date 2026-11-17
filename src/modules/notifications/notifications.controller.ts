import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { notificationsService } from './notifications.service';
import { pushService } from './push.service';
import { AppError } from '@core/errors';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { unsubscribeByToken } from './unsubscribe';
import { getEmailHealth } from './emailHealth.service';
import { resendNotification } from './emailRecovery';
import { listEmailTemplates, previewEmailTemplate, sendTestEmail } from './templatePreview.service';
import type { ListNotificationLogsQuery, BroadcastNotificationRequest } from './notifications.dto';

export const listLogs = asyncHandler(async (req: Request, res: Response) => {
  res.json(ok(await notificationsService.listLogs(req.query as ListNotificationLogsQuery)));
});

export const broadcast = asyncHandler(async (req: Request, res: Response) => {
  const result = await notificationsService.broadcast(req.user!.id, req.body as BroadcastNotificationRequest);
  res.status(201).json(ok(result));
});

export const createTest = asyncHandler(async (req: Request, res: Response) => {
  const log = await notificationsService.createTest(req.user!.id, req.body);
  res.status(201).json(ok(log));
});

export const health = asyncHandler(async (_req: Request, res: Response) => {
  res.json(ok(await getEmailHealth()));
});

export const resend = asyncHandler(async (req: Request, res: Response) => {
  const log = await resendNotification(String(req.params.id), req.user!.id);
  res.json(ok({ id: log.id, status: log.status }));
});

export const listTemplates = asyncHandler(async (_req: Request, res: Response) => {
  res.json(ok(await listEmailTemplates()));
});

export const previewTemplate = asyncHandler(async (req: Request, res: Response) => {
  res.json(ok(await previewEmailTemplate(String(req.params.type), req.query.theme === 'dark' ? 'dark' : 'light')));
});

export const sendTestTemplate = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json(ok(await sendTestEmail(String(req.params.type), req.user!.id)));
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

export const unsubscribe = asyncHandler(async (req: Request, res: Response) => {
  const token = String(req.query.token ?? (req.body as { token?: unknown } | undefined)?.token ?? '');
  res.json(ok(await unsubscribeByToken(token)));
});
