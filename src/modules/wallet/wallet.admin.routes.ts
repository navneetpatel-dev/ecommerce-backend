import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { AdjustWalletSchema, WalletUserSearchSchema } from './wallet.admin.dto';
import * as walletAdminController from './wallet.admin.controller';

const router = Router();

// Find the account to adjust (Finance has no Users page).
router.get(
  '/users',
  authenticate,
  authorize(PERMISSIONS.WALLET_ADJUST),
  validate(WalletUserSearchSchema, 'query'),
  walletAdminController.searchUsers,
);

router.post(
  '/:userId/adjust',
  authenticate,
  authorize(PERMISSIONS.WALLET_ADJUST),
  validate(AdjustWalletSchema),
  walletAdminController.adjustWallet,
);

export default router;
