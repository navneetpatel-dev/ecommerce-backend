import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { pageLimitQuerySchema } from '@core/http/pagination';
import { reviewsService } from './reviews.service';
import { CreateReviewSchema, VoteReviewSchema } from './reviews.dto';

export const listPending = asyncHandler(async (req: Request, res: Response) => {
  const query = pageLimitQuerySchema.parse(req.query);
  const result = await reviewsService.listPending(query);
  res.json(ok(result.reviews, { pagination: result.pagination }));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const dto = CreateReviewSchema.parse(req.body);
  const review = await reviewsService.createReview(req.user!.id, dto);
  res.status(201).json(ok(review));
});

export const getByProduct = asyncHandler(async (req: Request, res: Response) => {
  const reviews = await reviewsService.getProductReviews(req.params.productId!);
  res.json(ok(reviews));
});

export const getMyReviews = asyncHandler(async (req: Request, res: Response) => {
  const reviews = await reviewsService.getUserReviews(req.user!.id);
  res.json(ok(reviews));
});

export const getVendorReviews = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.vendorId) {
    throw new ForbiddenError(ERROR_MESSAGES.VENDOR_NOT_LINKED);
  }
  const reviews = await reviewsService.getVendorReviews(req.user.vendorId);
  res.json(ok(reviews));
});

export const vote = asyncHandler(async (req: Request, res: Response) => {
  const { vote: voteValue } = VoteReviewSchema.parse(req.body);
  const review = await reviewsService.voteReview(req.params.id!, req.user!.id, voteValue);
  res.json(ok(review));
});

export const approve = asyncHandler(async (req: Request, res: Response) => {
  const review = await reviewsService.approveReview(req.params.id!);
  res.json(ok(review));
});

export const reject = asyncHandler(async (req: Request, res: Response) => {
  const review = await reviewsService.rejectReview(req.params.id!);
  res.json(ok(review));
});

export const respond = asyncHandler(async (req: Request, res: Response) => {
  res.json(ok(await reviewsService.respondToReview(req.params.id!, req.user!.vendorId, req.body.response)));
});
