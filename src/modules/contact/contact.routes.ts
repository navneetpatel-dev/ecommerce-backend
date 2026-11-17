import { Router } from 'express';
import { optionalAuthenticate } from '@middleware/auth.middleware';
import { otpRequestRateLimiter } from '@middleware/rateLimiter.middleware';
import { validate } from '@middleware/validate.middleware';
import { CreateContactMessageSchema } from './contact.dto';
import * as contactController from './contact.controller';

const router = Router();

// Public, so it is rate limited like other endpoints that send mail to an arbitrary address.
router.post('/', otpRequestRateLimiter, optionalAuthenticate, validate(CreateContactMessageSchema), contactController.submit);

export default router;
