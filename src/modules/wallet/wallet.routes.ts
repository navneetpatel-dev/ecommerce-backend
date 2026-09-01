import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { validate } from '@middleware/validate.middleware';
import { reportExportGuard } from '@modules/reports/reportExportGuard';
import * as walletController from './wallet.controller';
import {
  CreateWalletRechargeSchema,
  VerifyWalletRechargeSchema,
} from './walletRecharge.dto';
import { WalletStatementSchema } from './walletStatement.dto';
import { ListTransactionsSchema } from './wallet.dto';

const router = Router();

router.get('/balance', authenticate, walletController.getBalance);

router.post(
  '/recharge',
  authenticate,
  validate(CreateWalletRechargeSchema),
  walletController.createRecharge,
);

router.post(
  '/recharge/verify',
  authenticate,
  validate(VerifyWalletRechargeSchema),
  walletController.verifyRecharge,
);

router.get('/recharge/:id', authenticate, walletController.getRecharge);

router.get('/recharge/:id/invoice', authenticate, walletController.downloadRechargeInvoice);

router.get(
  '/transactions',
  authenticate,
  validate(ListTransactionsSchema, 'query'),
  walletController.listTransactions,
);

router.get(
  '/statement',
  authenticate,
  validate(WalletStatementSchema, 'query'),
  reportExportGuard,
  walletController.exportStatement,
);

export default router;
