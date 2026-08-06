import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { checkoutService } from './checkout.service';
import { CancelCheckoutSchema, CreateCheckoutSchema, CheckoutQuoteSchema } from './checkout.dto';
import { verifyPayment } from '@modules/payments/payments.controller';

export const getCheckoutQuote = asyncHandler(async (req: Request, res: Response) => {
  const dto = CheckoutQuoteSchema.parse(req.body);
  const quote = await checkoutService.getQuote(req.user!.id, dto);
  res.json(ok(quote));
});

export const createCheckout = asyncHandler(async (req: Request, res: Response) => {
  const dto = CreateCheckoutSchema.parse(req.body);
  const result = await checkoutService.createOrderFromCart(req.user!.id, dto);
  res.status(201).json(ok(result));
});

export const cancelCheckout = asyncHandler(async (req: Request, res: Response) => {
  const dto = CancelCheckoutSchema.parse(req.body);
  const result = await checkoutService.cancelPendingCheckout(req.user!.id, dto);
  res.json(ok(result));
});

/** UX confirmation only — webhook remains the source of truth for PAID. */
export { verifyPayment as verifyCheckoutPayment };
