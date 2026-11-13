/**
 * Length limits for shopper-written content. Mirrored in the web app
 * (`web/src/shared/constants/ugc/ugcLimits.ts`) so the form counts and the API
 * agree; change both together.
 */
export const UGC_LIMITS = {
  question: { min: 10, max: 300 },
  answer: { min: 3, max: 1000 },
  reviewTitle: { max: 100 },
  reviewBody: { min: 20, max: 2000 },
} as const;
