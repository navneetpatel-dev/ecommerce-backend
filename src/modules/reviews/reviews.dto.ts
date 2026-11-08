import { z } from 'zod';
import { TICKET_ATTACHMENT_TYPE_VALUES } from '@core/constants/statuses';

export const CreateReviewSchema = z.object({
  orderItemId: z.string().uuid(),
  productId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  title: z.string().optional(),
  body: z.string().min(1),
  /** Id the review takes: its photos/video were uploaded under it before posting. */
  draftId: z.string().uuid().optional(),
  attachments: z
    .array(
      z.object({
        url: z.string().url(),
        type: z.enum(TICKET_ATTACHMENT_TYPE_VALUES),
        durationSeconds: z.number().positive().nullable().optional(),
      }),
    )
    .max(6)
    .optional()
    .default([]),
});

export const VoteReviewSchema = z.object({
  vote: z.enum(['HELPFUL', 'UNHELPFUL']),
});

export const RespondReviewSchema = z.object({
  response: z.string().min(1),
});

export type CreateReviewRequest = z.infer<typeof CreateReviewSchema>;
export type VoteReviewRequest = z.infer<typeof VoteReviewSchema>;
export type RespondReviewRequest = z.infer<typeof RespondReviewSchema>;
