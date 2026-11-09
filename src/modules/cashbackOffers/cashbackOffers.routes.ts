import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import {
  CashbackOfferListQuerySchema,
  CreateCashbackOfferSchema,
  UpdateCashbackOfferSchema,
} from './cashbackOffers.dto';
import * as controller from './cashbackOffers.controller';

const router = Router();

/** Public: the offers running now, for product, card and cart badges. */
router.get('/live', controller.liveCashbackOffers);

// Platform cashback is a promotion, so it sits with coupons under coupon.manage.
const manage = [authenticate, authorize(PERMISSIONS.COUPON_MANAGE)];
router.get('/', ...manage, validate(CashbackOfferListQuerySchema, 'query'), controller.listCashbackOffers);
router.post('/', ...manage, validate(CreateCashbackOfferSchema), controller.createCashbackOffer);
router.patch('/:id', ...manage, validate(UpdateCashbackOfferSchema), controller.updateCashbackOffer);
router.delete('/:id', ...manage, controller.deleteCashbackOffer);

export default router;
