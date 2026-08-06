import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { CreateReviewSchema, VoteReviewSchema, RespondReviewSchema } from './reviews.dto';
import * as reviewsController from './reviews.controller';

const router = Router();

router.get('/moderation', authenticate, authorize(PERMISSIONS.REVIEW_MODERATE), reviewsController.listPending);
router.post('/', authenticate, validate(CreateReviewSchema), reviewsController.create);
router.get('/product/:productId', reviewsController.getByProduct);
router.get('/my-reviews', authenticate, reviewsController.getMyReviews);
router.post('/:id/vote', authenticate, validate(VoteReviewSchema), reviewsController.vote);
router.patch('/:id/approve', authenticate, authorize(PERMISSIONS.REVIEW_MODERATE), reviewsController.approve);
router.patch('/:id/reject', authenticate, authorize(PERMISSIONS.REVIEW_MODERATE), reviewsController.reject);
router.patch('/:id/respond', authenticate, authorize(PERMISSIONS.REVIEW_RESPOND), validate(RespondReviewSchema), reviewsController.respond);

export default router;
