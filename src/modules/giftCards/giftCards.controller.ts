import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { giftCardsService } from './giftCards.service';
import { giftCardAccountsService } from './giftCardAccounts.service';
import { giftCardsAdminService } from './giftCardsAdmin.service';
import { pageLimitQuerySchema } from '@core/http/pagination';
import {
  PurchaseGiftCardSchema,
  VerifyGiftCardPurchaseSchema,
  RedeemGiftCardSchema,
  AdminGiftCardListQuerySchema,
  CancelGiftCardSchema,
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

export const myGiftCards = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = pageLimitQuerySchema.parse({ limit: req.query.limit });
  const pageOf = (value: unknown) => Math.max(1, Math.trunc(Number(value)) || page);
  res.json(ok(await giftCardAccountsService.mine(req.user!.id, {
    purchasedPage: pageOf(req.query.purchasedPage),
    redeemedPage: pageOf(req.query.redeemedPage),
    limit,
  })));
});

export const resendGiftCard = asyncHandler(async (req: Request, res: Response) => {
  res.json(ok(await giftCardAccountsService.resend(req.user!.id, req.params.id!)));
});

export const adminListGiftCards = asyncHandler(async (req: Request, res: Response) => {
  const query = AdminGiftCardListQuerySchema.parse(req.query);
  const result = await giftCardsAdminService.list(query);
  res.json(ok(result.items, { pagination: result.pagination }));
});

export const adminGiftCardLiability = asyncHandler(async (_req: Request, res: Response) => {
  res.json(ok(await giftCardsAdminService.liability()));
});

export const adminCancelGiftCard = asyncHandler(async (req: Request, res: Response) => {
  const { reason } = CancelGiftCardSchema.parse(req.body);
  res.json(ok(await giftCardsAdminService.cancel(req.user!.id, req.params.id!, reason)));
});
