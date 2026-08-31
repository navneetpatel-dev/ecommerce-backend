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
    const balance = await walletService.getBalance(req.user!.id);
    res.json(ok({ balance }));
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
