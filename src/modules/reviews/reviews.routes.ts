import { Router } from 'express';
import { authenticate, optionalAuthenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { CreateReviewSchema, VoteReviewSchema, RespondReviewSchema, UpdateReviewSchema } from './reviews.dto';
import * as reviewsController from './reviews.controller';

const router = Router();

router.get('/moderation', authenticate, authorize(PERMISSIONS.REVIEW_MODERATE), reviewsController.listPending);
router.post('/', authenticate, validate(CreateReviewSchema), reviewsController.create);
router.get('/product/:productId', optionalAuthenticate, reviewsController.getByProduct);
router.get('/product/:productId/eligibility', authenticate, reviewsController.getMyEligibility);
router.get('/my-reviews', authenticate, reviewsController.getMyReviews);
router.get('/awaiting', authenticate, reviewsController.getAwaitingReview);
router.get('/vendor/me', authenticate, authorize(PERMISSIONS.REVIEW_RESPOND), reviewsController.getVendorReviews);
router.patch('/:id', authenticate, validate(UpdateReviewSchema), reviewsController.update);
router.post('/:id/vote', authenticate, validate(VoteReviewSchema), reviewsController.vote);
router.patch('/:id/approve', authenticate, authorize(PERMISSIONS.REVIEW_MODERATE), reviewsController.approve);
router.patch('/:id/reject', authenticate, authorize(PERMISSIONS.REVIEW_MODERATE), reviewsController.reject);
router.patch('/:id/respond', authenticate, authorize(PERMISSIONS.REVIEW_RESPOND), validate(RespondReviewSchema), reviewsController.respond);

export default router;
