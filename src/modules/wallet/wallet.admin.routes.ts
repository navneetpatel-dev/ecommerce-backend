import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { AdjustWalletSchema } from './wallet.admin.dto';
import * as walletAdminController from './wallet.admin.controller';

const router = Router();

router.post(
  '/:userId/adjust',
  authenticate,
  authorize(PERMISSIONS.WALLET_ADJUST),
  validate(AdjustWalletSchema),
  walletAdminController.adjustWallet,
);

export default router;
