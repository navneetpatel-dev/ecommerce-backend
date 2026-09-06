import { Router } from 'express';
import { optionalAuthenticate, authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { RecordWebVitalSchema, WebVitalsSummarySchema } from './webVitals.dto';
import * as webVitalsController from './webVitals.controller';

const router = Router();

router.post(
  '/',
  optionalAuthenticate,
  validate(RecordWebVitalSchema),
  webVitalsController.record,
);

router.get(
  '/summary',
  authenticate,
  authorize(PERMISSIONS.ANALYTICS_VIEW),
  validate(WebVitalsSummarySchema, 'query'),
  webVitalsController.summary,
);

export default router;
