// Reviews module - Product reviews and ratings
import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { z } from 'zod';
import { validate } from '@middleware/validate.middleware';
import { reviewsService } from './reviews.service';

const CreateReviewSchema = z.object({
  orderItemId: z.string().uuid(),
  productId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  title: z.string().optional(),
  body: z.string().min(1),
});

const VoteReviewSchema = z.object({
  vote: z.enum(['HELPFUL', 'UNHELPFUL']),
});

const router = Router();

router.post('/', authenticate, validate(CreateReviewSchema), asyncHandler(async (req, res) => {
  const dto = CreateReviewSchema.parse(req.body);
  const review = await reviewsService.createReview(req.user!.id, dto);
  res.status(201).json(ok(review));
}));

router.get('/product/:productId', asyncHandler(async (req, res) => {
  const reviews = await reviewsService.getProductReviews(req.params.productId!);
  res.json(ok(reviews));
}));

router.get('/my-reviews', authenticate, asyncHandler(async (req, res) => {
  const reviews = await reviewsService.getUserReviews(req.user!.id);
  res.json(ok(reviews));
}));

router.post('/:id/vote', authenticate, validate(VoteReviewSchema), asyncHandler(async (req, res) => {
  const { vote } = VoteReviewSchema.parse(req.body);
  const review = await reviewsService.voteReview(req.params.id!, req.user!.id, vote);
  res.json(ok(review));
}));

router.patch('/:id/approve', authenticate, authorize('reviews.moderate'), asyncHandler(async (req, res) => {
  const review = await reviewsService.approveReview(req.params.id!);
  res.json(ok(review));
}));

router.patch('/:id/reject', authenticate, authorize('reviews.moderate'), asyncHandler(async (req, res) => {
  const review = await reviewsService.rejectReview(req.params.id!);
  res.json(ok(review));
}));

export default router;
