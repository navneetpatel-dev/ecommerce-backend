import { Router } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { getActiveBanners } from './homepage.service';

const router = Router();

router.get(
  '/banners',
  asyncHandler(async (_req, res) => {
    const banners = await getActiveBanners();
    res.json(ok(banners));
  }),
);

export default router;
