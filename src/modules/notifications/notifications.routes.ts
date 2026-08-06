import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import * as notificationsController from './notifications.controller';

const router = Router();

router.get('/logs', authenticate, authorize(PERMISSIONS.SETTINGS_MANAGE), notificationsController.listLogs);
router.post('/test', authenticate, authorize(PERMISSIONS.SETTINGS_MANAGE), notificationsController.createTest);

export default router;
