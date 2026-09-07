import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { validate } from '@middleware/validate.middleware';
import { authRateLimiter } from '@middleware/rateLimiter.middleware';
import {
  PurchaseGiftCardSchema,
  VerifyGiftCardPurchaseSchema,
  RedeemGiftCardSchema,
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

router.get('/:code', authRateLimiter, giftCardsController.getGiftCardByCode);

export default router;
