// Wallet module - Wallet balance and transaction management
import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { z } from 'zod';
import { validate } from '@middleware/validate.middleware';
import { walletService } from './wallet.service';

const GetTransactionsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const router = Router();

router.get('/balance', authenticate, asyncHandler(async (req, res) => {
  const balance = await walletService.getBalance(req.user!.id);
  res.json(ok({ balance }));
}));

router.get('/transactions', authenticate, validate(GetTransactionsSchema, 'query'), asyncHandler(async (req, res) => {
  const { page, limit } = GetTransactionsSchema.parse(req.query);
  const result = await walletService.getTransactions(req.user!.id, page, limit);
  res.json(ok(result.transactions, { pagination: result.pagination }));
}));

export default router;
