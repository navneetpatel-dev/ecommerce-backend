import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { CreatePromoBannerSchema, UpdatePromoBannerSchema } from './homepage.dto';
import * as homepageController from './homepage.controller';

const router = Router();

router.get('/banners', homepageController.getActiveBanners);

router.get(
  '/admin/banners',
  authenticate,
  authorize(PERMISSIONS.BANNER_MANAGE),
  homepageController.listBanners,
);
router.post(
  '/admin/banners',
  authenticate,
  authorize(PERMISSIONS.BANNER_MANAGE),
  validate(CreatePromoBannerSchema),
  homepageController.createBanner,
);
router.get(
  '/admin/banners/:id',
  authenticate,
  authorize(PERMISSIONS.BANNER_MANAGE),
  homepageController.getBannerById,
);
router.patch(
  '/admin/banners/:id',
  authenticate,
  authorize(PERMISSIONS.BANNER_MANAGE),
  validate(UpdatePromoBannerSchema),
  homepageController.updateBanner,
);
router.delete(
  '/admin/banners/:id',
  authenticate,
  authorize(PERMISSIONS.BANNER_MANAGE),
  homepageController.deleteBanner,
);

export default router;
