import { z } from 'zod';
import { pageLimitQuerySchema } from '@core/http/pagination';
import { ugcText } from '@core/http/ugcText';
import { UGC_LIMITS } from '@core/constants/ugcLimits';

export const AskQuestionSchema = z.object({
  productId: z.string().uuid(),
  question: ugcText('Question', UGC_LIMITS.question),
});

export const AnswerQuestionSchema = z.object({
  answer: ugcText('Answer', UGC_LIMITS.answer),
});

/** Moderation only ever moves a PENDING question to PUBLISHED or REJECTED. */
export const ModerateQuestionSchema = z.object({
  status: z.enum(['PUBLISHED', 'REJECTED']),
});

/** Owner edits: same limits as posting. */
export const UpdateQuestionSchema = z.object({ question: ugcText('Question', UGC_LIMITS.question) });
export const UpdateAnswerSchema = z.object({ answer: ugcText('Answer', UGC_LIMITS.answer) });

export type AskQuestionRequest = z.infer<typeof AskQuestionSchema>;
export type AnswerQuestionRequest = z.infer<typeof AnswerQuestionSchema>;
export type ModerateQuestionRequest = z.infer<typeof ModerateQuestionSchema>;

/** PDP / "all questions" list: a page at a time, searchable, by answered state, in a chosen order. */
export const PRODUCT_QUESTION_SORTS = ['recent', 'oldest', 'most_answered'] as const;
export const PRODUCT_QUESTION_ANSWERED = ['all', 'answered', 'unanswered'] as const;
export const ProductQuestionsQuerySchema = pageLimitQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  answered: z.enum(PRODUCT_QUESTION_ANSWERED).default('all'),
  sort: z.enum(PRODUCT_QUESTION_SORTS).default('recent'),
});

export type ProductQuestionsQuery = z.infer<typeof ProductQuestionsQuerySchema>;
