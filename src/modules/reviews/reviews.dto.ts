import { z } from 'zod';

export const CreateReviewSchema = z.object({
  orderItemId: z.string().uuid(),
  productId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  title: z.string().optional(),
  body: z.string().min(1),
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
