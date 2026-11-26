import { Router } from 'express';
import * as controller from './webhooks.controller';

const router = Router();

router.post('/razorpay', controller.handleRazorpay);

export default router;
