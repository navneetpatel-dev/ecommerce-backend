import type { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { cashbackOffersService } from './cashbackOffers.service';
import {
  CashbackOfferListQuerySchema,
  CreateCashbackOfferSchema,
  UpdateCashbackOfferSchema,
} from './cashbackOffers.dto';

export const liveCashbackOffers = asyncHandler(async (_req: Request, res: Response) => {
  res.json(ok(await cashbackOffersService.publicLive()));
});

export const listCashbackOffers = asyncHandler(async (req: Request, res: Response) => {
  const { items, pagination } = await cashbackOffersService.list(CashbackOfferListQuerySchema.parse(req.query));
  res.json(ok(items, { pagination }));
});

export const createCashbackOffer = asyncHandler(async (req: Request, res: Response) => {
  const offer = await cashbackOffersService.create(req.user!.id, CreateCashbackOfferSchema.parse(req.body));
  res.status(201).json(ok(offer));
});

export const updateCashbackOffer = asyncHandler(async (req: Request, res: Response) => {
  const offer = await cashbackOffersService.update(req.user!.id, req.params.id!, UpdateCashbackOfferSchema.parse(req.body));
  res.json(ok(offer));
});

export const deleteCashbackOffer = asyncHandler(async (req: Request, res: Response) => {
  await cashbackOffersService.remove(req.user!.id, req.params.id!);
  res.json(ok({ deleted: true }));
});
