import { Router } from 'express';
import { validate } from '@middleware/validate.middleware';
import { otpRequestRateLimiter } from '@middleware/rateLimiter.middleware';
import { NewsletterTokenSchema, SubscribeNewsletterSchema } from './newsletter.dto';
import * as newsletterController from './newsletter.controller';

const router = Router();

router.post(
  '/subscribe',
  otpRequestRateLimiter,
  validate(SubscribeNewsletterSchema),
  newsletterController.subscribe,
);

router.post('/confirm', validate(NewsletterTokenSchema), newsletterController.confirm);
router.post('/unsubscribe', validate(NewsletterTokenSchema), newsletterController.unsubscribe);

export default router;
