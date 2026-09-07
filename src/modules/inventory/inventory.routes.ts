import { Router } from 'express';
import { authenticate, optionalAuthenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { checkProductVariantOwnership } from '@middleware/ownership.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { CreateStockAlertSchema, DeleteStockAlertQuerySchema, UpdateStockSchema } from './inventory.dto';
import * as inventoryController from './inventory.controller';

const router = Router();

router.get('/low-stock', authenticate, authorize(PERMISSIONS.PRODUCT_MANAGE, PERMISSIONS.PRODUCT_UPDATE), inventoryController.getLowStock);
router.patch('/variants/:variantId/stock', authenticate, authorize(PERMISSIONS.PRODUCT_MANAGE, PERMISSIONS.PRODUCT_UPDATE), checkProductVariantOwnership(), validate(UpdateStockSchema), inventoryController.updateStock);

// Back-in-stock alert subscriptions: open to guests (optionalAuthenticate), since a
// shopper browsing without an account should still be able to ask to be notified.
router.post('/stock-alerts', optionalAuthenticate, validate(CreateStockAlertSchema), inventoryController.createStockAlert);
router.delete(
  '/stock-alerts/:id',
  optionalAuthenticate,
  validate(DeleteStockAlertQuerySchema, 'query'),
  inventoryController.deleteStockAlert,
);

export default router;
