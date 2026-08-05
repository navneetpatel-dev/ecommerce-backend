import { Router } from 'express';
import * as checkoutController from './checkout.controller';
import { authenticate } from '@middleware/auth.middleware';
import { validate } from '@middleware/validate.middleware';
import { CreateCheckoutSchema } from './checkout.dto';

const router = Router();

router.post('/', authenticate, validate(CreateCheckoutSchema), checkoutController.createCheckout);

export default router;
