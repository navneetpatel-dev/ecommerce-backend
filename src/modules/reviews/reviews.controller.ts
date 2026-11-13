import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { pageLimitQuerySchema } from '@core/http/pagination';
import { reviewsService } from './reviews.service';
import { findProductsAwaitingReview, findReviewableOrderItem } from './reviewEligibility';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { CreateReviewSchema, ProductReviewsQuerySchema, UpdateReviewSchema, VoteReviewSchema } from './reviews.dto';

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
  const query = ProductReviewsQuerySchema.parse(req.query);
  const result = await reviewsService.getProductReviewPage(req.params.productId!, query, req.user?.id);
  res.json(
    ok(result.reviews, { pagination: result.pagination, summary: result.summary, myReview: result.myReview }),
  );
});

export const getMyReviews = asyncHandler(async (req: Request, res: Response) => {
  const result = await reviewsService.getUserReviews(req.user!.id, pageLimitQuerySchema.parse(req.query));
  res.json(ok(result.reviews, { pagination: result.pagination }));
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

/** PDP "Write a review": the signed-in shopper's delivered, unreviewed line for this product, if any. */
export const getMyEligibility = asyncHandler(async (req: Request, res: Response) => {
  const orderItemId = await findReviewableOrderItem(req.user!.id, req.params.productId!);
  res.json(ok({ orderItemId }));
});

/** Owner edit (stars + text); goes back to moderation. */
export const update = asyncHandler(async (req: Request, res: Response) => {
  const dto = UpdateReviewSchema.parse(req.body);
  res.json(ok(await reviewsService.updateOwnReview(req.params.id!, req.user!.id, dto)));
});

/** Delivered products the shopper has not reviewed yet, newest first. */
export const getAwaitingReview = asyncHandler(async (req: Request, res: Response) => {
  const query = pageLimitQuerySchema.parse(req.query);
  const { rows, count } = await findProductsAwaitingReview(
    req.user!.id,
    query.limit,
    paginationOffset(query.page, query.limit),
  );
  res.json(ok(rows, { pagination: buildPaginationMeta(count, query.page, query.limit) }));
});
