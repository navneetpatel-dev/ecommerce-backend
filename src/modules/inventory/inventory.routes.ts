import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { UpdateStockSchema } from './inventory.dto';
import * as inventoryController from './inventory.controller';

const router = Router();

router.get('/low-stock', authenticate, authorize(PERMISSIONS.PRODUCT_MANAGE, PERMISSIONS.PRODUCT_UPDATE), inventoryController.getLowStock);
router.patch('/variants/:variantId/stock', authenticate, authorize(PERMISSIONS.PRODUCT_MANAGE, PERMISSIONS.PRODUCT_UPDATE), validate(UpdateStockSchema), inventoryController.updateStock);

export default router;
