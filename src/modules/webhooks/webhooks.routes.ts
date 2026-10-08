import { Router } from 'express';
import * as controller from './webhooks.controller';

const router = Router();

router.post('/razorpay', controller.handleRazorpay);

router.post('/ses', controller.handleSes);

export default router;
