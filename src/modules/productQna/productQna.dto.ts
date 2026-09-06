import { z } from 'zod';

export const AskQuestionSchema = z.object({
  productId: z.string().uuid(),
  question: z.string().min(3).max(1000),
});

export const AnswerQuestionSchema = z.object({
  answer: z.string().min(1).max(2000),
});

/** Moderation only ever moves a PENDING question to PUBLISHED or REJECTED. */
export const ModerateQuestionSchema = z.object({
  status: z.enum(['PUBLISHED', 'REJECTED']),
});

export type AskQuestionRequest = z.infer<typeof AskQuestionSchema>;
export type AnswerQuestionRequest = z.infer<typeof AnswerQuestionSchema>;
export type ModerateQuestionRequest = z.infer<typeof ModerateQuestionSchema>;
