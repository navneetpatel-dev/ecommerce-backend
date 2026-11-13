import { z } from 'zod';
import { TICKET_ATTACHMENT_TYPE_VALUES } from '@core/constants/statuses';
import { pageLimitQuerySchema } from '@core/http/pagination';
import { ugcText } from '@core/http/ugcText';
import { UGC_LIMITS } from '@core/constants/ugcLimits';

const reviewTitle = ugcText('Title', UGC_LIMITS.reviewTitle).optional();
const reviewBody = ugcText('Review', UGC_LIMITS.reviewBody);

const ReviewAttachmentsSchema = z
  .array(
    z.object({
      url: z.string().url(),
      type: z.enum(TICKET_ATTACHMENT_TYPE_VALUES),
      durationSeconds: z.number().positive().nullable().optional(),
    }),
  )
  .max(6);

export const CreateReviewSchema = z.object({
  orderItemId: z.string().uuid(),
  productId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  title: reviewTitle,
  body: reviewBody,
  /** Id the review takes: its photos/video were uploaded under it before posting. */
  draftId: z.string().uuid().optional(),
  attachments: ReviewAttachmentsSchema.optional().default([]),
});

/** Owner edit of the text and stars (photos stay as posted). */
export const UpdateReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: reviewTitle,
  body: reviewBody,
  /** The full photo/video list after editing; omitted = keep what is there. */
  attachments: ReviewAttachmentsSchema.optional(),
});

export const VoteReviewSchema = z.object({
  vote: z.enum(['HELPFUL', 'UNHELPFUL']),
});

export const RespondReviewSchema = z.object({
  response: z.string().min(1),
});

export type CreateReviewRequest = z.infer<typeof CreateReviewSchema>;
export type UpdateReviewRequest = z.infer<typeof UpdateReviewSchema>;
export type VoteReviewRequest = z.infer<typeof VoteReviewSchema>;
export type RespondReviewRequest = z.infer<typeof RespondReviewSchema>;

/** PDP review list: a page at a time, narrowed by stars / photos, in a chosen order. */
export const PRODUCT_REVIEW_SORTS = ['recent', 'helpful', 'highest', 'lowest'] as const;
export const ProductReviewsQuerySchema = pageLimitQuerySchema.extend({
  rating: z.coerce.number().int().min(1).max(5).optional(),
  withMedia: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  sort: z.enum(PRODUCT_REVIEW_SORTS).default('recent'),
});

export type ProductReviewsQuery = z.infer<typeof ProductReviewsQuerySchema>;
