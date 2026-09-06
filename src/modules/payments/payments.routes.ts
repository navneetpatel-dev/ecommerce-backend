import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import * as paymentsController from './payments.controller';

/**
 * Saved/tokenized payment method management. `/verify` (checkout confirmation)
 * and the `/razorpay` webhook stay mounted from checkout.routes.ts and
 * webhooks.routes.ts respectively — this router is only for the new
 * saved-methods surface, mounted at API_MOUNTS.payments (see apiPaths.ts).
 */
const router = Router();

router.get('/saved-methods', authenticate, paymentsController.listSavedMethods);
router.delete('/saved-methods/:id', authenticate, paymentsController.deleteSavedMethod);

export default router;
