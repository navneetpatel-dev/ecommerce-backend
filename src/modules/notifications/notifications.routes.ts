import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { validate } from '@middleware/validate.middleware';
import { PushSubscriptionSchema, RemovePushSubscriptionSchema } from './push.dto';
import * as notificationsController from './notifications.controller';

const router = Router();

router.get('/logs', authenticate, authorize(PERMISSIONS.SETTINGS_MANAGE), notificationsController.listLogs);
router.post('/test', authenticate, authorize(PERMISSIONS.SETTINGS_MANAGE), notificationsController.createTest);
router.get('/push/public-key', authenticate, notificationsController.pushPublicKey);
router.post('/push/subscribe', authenticate, validate(PushSubscriptionSchema), notificationsController.subscribePush);
router.delete('/push/subscribe', authenticate, validate(RemovePushSubscriptionSchema, 'query'), notificationsController.unsubscribePush);

export default router;
