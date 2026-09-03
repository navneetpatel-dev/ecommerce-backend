import { Router } from 'express';
import { optionalAuthenticate } from '@middleware/auth.middleware';
import { validate } from '@middleware/validate.middleware';
import { RecordWebVitalSchema } from './webVitals.dto';
import * as webVitalsController from './webVitals.controller';

const router = Router();

router.post(
  '/',
  optionalAuthenticate,
  validate(RecordWebVitalSchema),
  webVitalsController.record,
);

export default router;
