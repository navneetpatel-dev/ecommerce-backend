import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { couponsService } from './coupons.service';
import { CreateCouponSchema, ApplyCouponSchema } from './coupons.dto';

export const createCoupon = asyncHandler(async (req: Request, res: Response) => {
  const dto = CreateCouponSchema.parse(req.body);
  const coupon = await couponsService.createCoupon(dto, req.user!.id);
  res.status(201).json(ok(coupon));
});

export const listCoupons = asyncHandler(async (_req: Request, res: Response) => {
  res.json(ok(await couponsService.listCoupons()));
});

export const applyCoupon = asyncHandler(async (req: Request, res: Response) => {
  const { code } = ApplyCouponSchema.parse(req.body);
  const result = await couponsService.applyCoupon(code, req.user!.id);
  res.json(ok(result));
});

export const removeCoupon = asyncHandler(async (_req: Request, res: Response) => {
  res.status(204).send();
});
