import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { validate } from '@middleware/validate.middleware';
import { PushSubscriptionSchema, RemovePushSubscriptionSchema } from './push.dto';
import {
  ListNotificationLogsQuerySchema,
  BroadcastNotificationSchema,
  BroadcastPreviewSchema,
  BroadcastRenderPreviewSchema,
} from './notifications.dto';
import * as notificationsController from './notifications.controller';

const router = Router();

router.get(
  '/logs',
  authenticate,
  authorize(PERMISSIONS.SETTINGS_MANAGE),
  validate(ListNotificationLogsQuerySchema, 'query'),
  notificationsController.listLogs,
);
router.get('/health', authenticate, authorize(PERMISSIONS.SETTINGS_MANAGE), notificationsController.health);
router.post('/logs/:id/resend', authenticate, authorize(PERMISSIONS.SETTINGS_MANAGE), notificationsController.resend);
router.get('/templates', authenticate, authorize(PERMISSIONS.SETTINGS_MANAGE), notificationsController.listTemplates);
router.get('/templates/:type/preview', authenticate, authorize(PERMISSIONS.SETTINGS_MANAGE), notificationsController.previewTemplate);
router.post('/templates/:type/test', authenticate, authorize(PERMISSIONS.SETTINGS_MANAGE), notificationsController.sendTestTemplate);
router.post('/test', authenticate, authorize(PERMISSIONS.SETTINGS_MANAGE), notificationsController.createTest);
router.post(
  '/broadcast',
  authenticate,
  authorize(PERMISSIONS.SETTINGS_MANAGE),
  validate(BroadcastNotificationSchema),
  notificationsController.broadcast,
);
router.post(
  '/broadcast/preview',
  authenticate,
  authorize(PERMISSIONS.SETTINGS_MANAGE),
  validate(BroadcastPreviewSchema),
  notificationsController.previewBroadcastTargets,
);
router.post(
  '/broadcast/render-preview',
  authenticate,
  authorize(PERMISSIONS.SETTINGS_MANAGE),
  validate(BroadcastRenderPreviewSchema),
  notificationsController.renderBroadcastPreview,
);
router.post(
  '/broadcast/test',
  authenticate,
  authorize(PERMISSIONS.SETTINGS_MANAGE),
  validate(BroadcastNotificationSchema),
  notificationsController.sendBroadcastTest,
);
router.get('/broadcasts', authenticate, authorize(PERMISSIONS.SETTINGS_MANAGE), notificationsController.listBroadcasts);
router.post('/broadcasts/:id/cancel', authenticate, authorize(PERMISSIONS.SETTINGS_MANAGE), notificationsController.cancelBroadcast);
router.get('/broadcast-users', authenticate, authorize(PERMISSIONS.SETTINGS_MANAGE), notificationsController.searchBroadcastUsers);
router.get('/broadcast-categories', authenticate, authorize(PERMISSIONS.SETTINGS_MANAGE), notificationsController.searchBroadcastCategories);
router.get('/broadcast-locations', authenticate, authorize(PERMISSIONS.SETTINGS_MANAGE), notificationsController.searchBroadcastLocations);
router.get('/in-app', authenticate, notificationsController.listInAppNotifications);
router.patch('/in-app/:id/read', authenticate, notificationsController.markInAppRead);
router.post('/in-app/read-all', authenticate, notificationsController.markAllInAppRead);
// Public: the link in marketing emails and the one-click POST mail apps send (RFC 8058).
router.post('/unsubscribe', notificationsController.unsubscribe);
router.get('/push/public-key', authenticate, notificationsController.pushPublicKey);
router.post('/push/subscribe', authenticate, validate(PushSubscriptionSchema), notificationsController.subscribePush);
router.delete('/push/subscribe', authenticate, validate(RemovePushSubscriptionSchema, 'query'), notificationsController.unsubscribePush);

export default router;
