import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { validate } from '@middleware/validate.middleware';
import { authRateLimiter } from '@middleware/rateLimiter.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import {
  PurchaseGiftCardSchema,
  VerifyGiftCardPurchaseSchema,
  RedeemGiftCardSchema,
  AdminGiftCardListQuerySchema,
  CancelGiftCardSchema,
} from './giftCards.dto';
import * as giftCardsController from './giftCards.controller';

const router = Router();

router.post(
  '/purchase',
  authenticate,
  validate(PurchaseGiftCardSchema),
  giftCardsController.purchaseGiftCard,
);

router.post(
  '/verify',
  authenticate,
  validate(VerifyGiftCardPurchaseSchema),
  giftCardsController.verifyGiftCardPurchase,
);

router.post(
  '/redeem',
  authenticate,
  validate(RedeemGiftCardSchema),
  giftCardsController.redeemGiftCard,
);

// Named routes before '/:code', which would otherwise take them as a code.
router.get('/mine', authenticate, giftCardsController.myGiftCards);
router.post('/:id/resend', authenticate, authRateLimiter, giftCardsController.resendGiftCard);
router.get(
  '/admin',
  authenticate,
  authorize(PERMISSIONS.GIFT_CARD_MANAGE),
  validate(AdminGiftCardListQuerySchema, 'query'),
  giftCardsController.adminListGiftCards,
);
router.get('/admin/liability', authenticate, authorize(PERMISSIONS.GIFT_CARD_MANAGE), giftCardsController.adminGiftCardLiability);
router.post(
  '/admin/:id/cancel',
  authenticate,
  authorize(PERMISSIONS.GIFT_CARD_MANAGE),
  validate(CancelGiftCardSchema),
  giftCardsController.adminCancelGiftCard,
);

router.get('/:code', authRateLimiter, giftCardsController.getGiftCardByCode);

export default router;
