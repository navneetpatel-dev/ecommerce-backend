import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import * as homepageService from './homepage.service';
import { CreatePromoBannerSchema, UpdatePromoBannerSchema } from './homepage.dto';

export const getActiveBanners = asyncHandler(async (_req: Request, res: Response) => {
  const banners = await homepageService.getActiveBanners();
  res.json(ok(banners));
});

export const listBanners = asyncHandler(async (_req: Request, res: Response) => {
  const banners = await homepageService.listBanners();
  res.json(ok(banners));
});

export const getBannerById = asyncHandler(async (req: Request, res: Response) => {
  const banner = await homepageService.getBannerById(req.params.id!);
  res.json(ok(banner));
});

export const createBanner = asyncHandler(async (req: Request, res: Response) => {
  const dto = CreatePromoBannerSchema.parse(req.body);
  const banner = await homepageService.createBanner(dto);
  res.status(201).json(ok(banner));
});

export const updateBanner = asyncHandler(async (req: Request, res: Response) => {
  const dto = UpdatePromoBannerSchema.parse(req.body);
  const banner = await homepageService.updateBanner(req.params.id!, dto);
  res.json(ok(banner));
});

export const deleteBanner = asyncHandler(async (req: Request, res: Response) => {
  await homepageService.deleteBanner(req.params.id!);
  res.status(204).send();
});
