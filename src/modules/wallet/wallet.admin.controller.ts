import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { AdjustWalletSchema } from './wallet.admin.dto';
import { walletAdminService } from './wallet.admin.service';

export const adjustWallet = asyncHandler(async (req: Request, res: Response) => {
  const body = AdjustWalletSchema.parse(req.body);
  const result = await walletAdminService.adjustWallet(
    String(req.params.userId),
    req.user!.id,
    body,
  );
  res.json(ok(result));
});
