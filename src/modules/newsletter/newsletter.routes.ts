import { Router } from 'express';
import { validate } from '@middleware/validate.middleware';
import { SubscribeNewsletterSchema } from './newsletter.dto';
import * as newsletterController from './newsletter.controller';

const router = Router();

router.post(
  '/subscribe',
  validate(SubscribeNewsletterSchema),
  newsletterController.subscribe,
);

export default router;
