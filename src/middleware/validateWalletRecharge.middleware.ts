import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '@core/errors/ValidationError';
import { buildCreateWalletRechargeSchema } from '@modules/wallet/walletRecharge.dto';
import { walletRechargeService } from '@modules/wallet/walletRecharge.service';

export async function validateCreateWalletRecharge(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const limits = await walletRechargeService.getRechargeLimits();
    const schema = buildCreateWalletRechargeSchema({
      minInr: limits.minInr,
      maxInr: limits.maxInr,
    });
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? 'Validation failed';
      return next(new ValidationError(message));
    }
    req.body = result.data;
    next();
  } catch (err) {
    next(err);
  }
}
