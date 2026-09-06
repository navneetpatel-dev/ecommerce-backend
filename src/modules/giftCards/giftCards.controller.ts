import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { giftCardsService } from './giftCards.service';
import {
  PurchaseGiftCardSchema,
  VerifyGiftCardPurchaseSchema,
  RedeemGiftCardSchema,
} from './giftCards.dto';

export const purchaseGiftCard = asyncHandler(async (req: Request, res: Response) => {
  const dto = PurchaseGiftCardSchema.parse(req.body);
  const result = await giftCardsService.purchase(req.user!.id, dto);
  res.status(201).json(ok(result));
});

export const verifyGiftCardPurchase = asyncHandler(async (req: Request, res: Response) => {
  const dto = VerifyGiftCardPurchaseSchema.parse(req.body);
  const result = await giftCardsService.verifyPurchase(req.user!.id, {
    razorpayOrderId: dto.razorpayOrderId!,
    razorpayPaymentId: dto.razorpayPaymentId!,
    razorpaySignature: dto.razorpaySignature!,
    giftCardId: dto.giftCardId,
  });
  res.json(ok(result));
});

export const redeemGiftCard = asyncHandler(async (req: Request, res: Response) => {
  const { code } = RedeemGiftCardSchema.parse(req.body);
  const result = await giftCardsService.redeem(req.user!.id, code);
  res.json(ok(result));
});

export const getGiftCardByCode = asyncHandler(async (req: Request, res: Response) => {
  const result = await giftCardsService.getPublicByCode(req.params.code!);
  res.json(ok(result));
});
