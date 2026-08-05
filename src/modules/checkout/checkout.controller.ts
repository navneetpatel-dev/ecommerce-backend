import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { checkoutService } from './checkout.service';
import { CreateCheckoutSchema } from './checkout.dto';

export const createCheckout = asyncHandler(async (req: Request, res: Response) => {
  const dto = CreateCheckoutSchema.parse(req.body);
  const order = await checkoutService.createOrderFromCart(req.user!.id, dto);
  res.status(201).json(ok(order));
});
