import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { UpdateSettingsSchema } from './settings.dto';
import * as settingsController from './settings.controller';

const router = Router();

router.get('/public', settingsController.getPublicSettings);

router.get('/', authenticate, authorize(PERMISSIONS.SETTINGS_MANAGE), settingsController.getSettings);

router.put(
  '/',
  authenticate,
  authorize(PERMISSIONS.SETTINGS_MANAGE),
  validate(UpdateSettingsSchema),
  settingsController.updateSettings,
);

export default router;
