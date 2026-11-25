import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { notificationsService } from './notifications.service';
import { broadcastService } from './broadcast.service';
import { inAppNotificationsService } from './inAppNotifications.service';
import { pushService } from './push.service';
import { AppError } from '@core/errors';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { unsubscribeByToken } from './unsubscribe';
import { getEmailHealth } from './emailHealth.service';
import { bulkResendNotifications, previewBulkResendNotifications, resendNotification } from './emailRecovery';
import { listSuppressions, unsuppressEmail } from './emailSuppression';
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

export const previewBulkResend = asyncHandler(async (req: Request, res: Response) => {
  res.json(ok(await previewBulkResendNotifications(req.body)));
});

export const bulkResend = asyncHandler(async (req: Request, res: Response) => {
  res.json(ok(await bulkResendNotifications(req.user!.id, req.body)));
});

export const retryBroadcastFailed = asyncHandler(async (req: Request, res: Response) => {
  res.json(ok(await broadcastService.retryFailedForBroadcast(String(req.params.id), req.user!.id)));
});

export const sendBroadcastRecordTest = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json(ok(await broadcastService.sendTestForBroadcast(String(req.params.id), req.user!.id)));
});

export const listEmailSuppressions = asyncHandler(async (req: Request, res: Response) => {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 25);
  res.json(
    ok(
      await listSuppressions({
        search: req.query.search ? String(req.query.search) : undefined,
        page: Number.isFinite(page) ? page : 1,
        limit: Number.isFinite(limit) ? limit : 25,
      }),
    ),
  );
});

export const clearEmailSuppression = asyncHandler(async (req: Request, res: Response) => {
  res.json(ok(await unsuppressEmail(String(req.body.email))));
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

export const previewBroadcastTargets = asyncHandler(async (req: Request, res: Response) => {
  res.json(ok(await broadcastService.previewTargets(req.body)));
});

export const renderBroadcastPreview = asyncHandler(async (req: Request, res: Response) => {
  res.json(ok(broadcastService.renderPreview(req.body)));
});

export const sendBroadcastTest = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json(ok(await broadcastService.sendTestToActor(req.user!.id, req.body)));
});

export const listBroadcasts = asyncHandler(async (req: Request, res: Response) => {
  const limit = Number(req.query.limit ?? 50);
  res.json(ok(await broadcastService.listBroadcasts(Number.isFinite(limit) ? limit : 50)));
});

export const cancelBroadcast = asyncHandler(async (req: Request, res: Response) => {
  res.json(ok(await broadcastService.cancelScheduled(String(req.params.id))));
});

export const searchBroadcastUsers = asyncHandler(async (req: Request, res: Response) => {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 20);
  res.json(
    ok(
      await broadcastService.searchTargetUsers(
        String(req.query.q ?? ''),
        Number.isFinite(page) ? page : 1,
        Number.isFinite(limit) ? limit : 20,
      ),
    ),
  );
});

export const searchBroadcastCategories = asyncHandler(async (req: Request, res: Response) => {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 20);
  res.json(
    ok(
      await broadcastService.searchCategories(
        String(req.query.q ?? ''),
        Number.isFinite(page) ? page : 1,
        Number.isFinite(limit) ? limit : 20,
      ),
    ),
  );
});

export const searchBroadcastLocations = asyncHandler(async (req: Request, res: Response) => {
  const field = req.query.field === 'city' ? 'city' : 'state';
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 20);
  res.json(
    ok(
      await broadcastService.searchLocations(
        field,
        String(req.query.q ?? ''),
        Number.isFinite(page) ? page : 1,
        Number.isFinite(limit) ? limit : 20,
      ),
    ),
  );
});

export const listInAppNotifications = asyncHandler(async (req: Request, res: Response) => {
  const limit = Number(req.query.limit ?? 20);
  const unreadOnly = req.query.unreadOnly === 'true';
  res.json(ok(await inAppNotificationsService.listForUser(req.user!.id, { limit, unreadOnly })));
});

export const markInAppRead = asyncHandler(async (req: Request, res: Response) => {
  await inAppNotificationsService.markRead(req.user!.id, String(req.params.id));
  res.json(ok({ read: true }));
});

export const markAllInAppRead = asyncHandler(async (req: Request, res: Response) => {
  await inAppNotificationsService.markAllRead(req.user!.id);
  res.json(ok({ readAll: true }));
});
