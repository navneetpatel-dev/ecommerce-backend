import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '@middleware/auth.middleware';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { validate } from '@middleware/validate.middleware';
import { resolvePermissionsForUser } from '@middleware/rbac.middleware';
import { roleNameOf } from '@utils/userRole';
import { reportExportGuard } from '@modules/reports/reportExportGuard';
import { walletService } from './wallet.service';
import { walletRechargeService } from './walletRecharge.service';
import {
  CreateWalletRechargeSchema,
  VerifyWalletRechargeSchema,
} from './walletRecharge.dto';
import { exportWalletStatement, WalletStatementSchema } from './walletStatement.service';
import type { PermissionKey } from '@core/permissions/permissionKeys';

const ListTransactionsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const router = Router();

router.get(
  '/balance',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const [balance, limits] = await Promise.all([
      walletService.getBalance(userId),
      walletRechargeService.getRechargeLimits(),
    ]);
    res.json(
      ok({
        balance,
        points: balance,
        unit: 'POINT' as const,
        redemptionRate: 1,
        rechargeEnabled: limits.rechargeEnabled,
        limits: {
          minInr: limits.minInr,
          maxInr: limits.maxInr,
          maxBalance: limits.maxBalance,
          presetsInr: limits.presetsInr,
          pointsPerRupee: limits.pointsPerRupee,
        },
      }),
    );
  }),
);

router.post(
  '/recharge',
  authenticate,
  validate(CreateWalletRechargeSchema),
  asyncHandler(async (req, res) => {
    const body = CreateWalletRechargeSchema.parse(req.body);
    const checkout = await walletRechargeService.createRecharge(
      req.user!.id,
      body.amountInr,
      body.idempotencyKey,
    );
    res.json(ok(checkout));
  }),
);

router.post(
  '/recharge/verify',
  authenticate,
  validate(VerifyWalletRechargeSchema),
  asyncHandler(async (req, res) => {
    const body = VerifyWalletRechargeSchema.parse(req.body);
    const result = await walletRechargeService.verifyRecharge(req.user!.id, {
      razorpayOrderId: body.razorpayOrderId!,
      razorpayPaymentId: body.razorpayPaymentId!,
      razorpaySignature: body.razorpaySignature!,
      rechargeId: body.rechargeId,
    });
    res.json(ok(result));
  }),
);

router.get(
  '/recharge/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const result = await walletRechargeService.getRecharge(
      req.user!.id,
      String(req.params.id),
    );
    res.json(ok(result));
  }),
);

router.get(
  '/transactions',
  authenticate,
  validate(ListTransactionsSchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = ListTransactionsSchema.parse(req.query);
    const rows = await walletService.listTransactions(req.user!.id, query);
    res.json(
      ok({
        transactions: rows.map((row) => ({
          id: row.id,
          type: row.type,
          amount: Number(row.amount),
          balanceAfter: Number(row.balanceAfter),
          referenceType: row.referenceType,
          referenceId: row.referenceId,
          description: row.description,
          pointSource: row.pointSource,
          createdAt: row.createdAt,
        })),
      }),
    );
  }),
);

router.get(
  '/statement',
  authenticate,
  validate(WalletStatementSchema, 'query'),
  reportExportGuard,
  asyncHandler(async (req, res) => {
    const query = WalletStatementSchema.parse(req.query);
    const user = req.user!;
    const roleName = user.role?.name ?? roleNameOf(user as any);
    const permissions = (await resolvePermissionsForUser({
      roleId: user.roleId,
      role: { name: roleName },
    })) as PermissionKey[];
    const exported = await exportWalletStatement({
      actor: {
        id: user.id,
        vendorId: user.vendorId ?? null,
        roleName,
        permissions,
      },
      from: query.from,
      to: query.to,
      format: query.format,
    });
    res.json(ok({ ...exported, async: true }));
  }),
);

export default router;
