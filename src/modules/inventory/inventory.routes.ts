import { Router } from 'express';
import { authenticate, optionalAuthenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { checkProductVariantOwnership } from '@middleware/ownership.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { CancelStockAlertSchema, CreateStockAlertSchema, UpdateStockSchema } from './inventory.dto';
import { stockAlertRateLimiter } from '@middleware/rateLimiter.middleware';
import * as inventoryController from './inventory.controller';

const router = Router();

router.get('/low-stock', authenticate, authorize(PERMISSIONS.PRODUCT_MANAGE, PERMISSIONS.PRODUCT_UPDATE), inventoryController.getLowStock);
router.patch('/variants/:variantId/stock', authenticate, authorize(PERMISSIONS.PRODUCT_MANAGE, PERMISSIONS.PRODUCT_UPDATE), checkProductVariantOwnership(), validate(UpdateStockSchema), inventoryController.updateStock);

// Back-in-stock alert subscriptions: open to guests (optionalAuthenticate), since a
// shopper browsing without an account should still be able to ask to be notified.
router.post('/stock-alerts', stockAlertRateLimiter, optionalAuthenticate, validate(CreateStockAlertSchema), inventoryController.createStockAlert);
// The cancel link in an alert email: the signed token is the proof.
router.post('/stock-alerts/unsubscribe', validate(CancelStockAlertSchema), inventoryController.cancelStockAlert);
router.delete('/stock-alerts/:id', authenticate, inventoryController.deleteStockAlert);

export default router;
