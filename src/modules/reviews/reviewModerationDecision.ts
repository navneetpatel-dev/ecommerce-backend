import { REVIEW_STATUS } from '@core/constants/statuses';
import { screenContent } from '@utils/contentFilter';
import type { ReviewMediaItem } from '@database/models/review.model';

export interface ReviewModerationInput {
  rating: number;
  title?: string | null;
  body?: string | null;
  media?: ReviewMediaItem[];
  autoApproveEnabled?: boolean;
}

export interface ReviewModerationDecision {
  status: typeof REVIEW_STATUS.APPROVED | typeof REVIEW_STATUS.PENDING;
  flaggedReason: string | null;
  flaggedAt: Date | null;
  isAutoApproved: boolean;
}

/**
 * Determines whether a new review or edit is eligible for immediate auto-approval
 * or should be routed to the moderation queue.
 *
 * Rules:
 * 1. If autoApproveEnabled is false -> PENDING (manual moderation mode).
 * 2. If review has media (images/videos) -> PENDING (requires media inspection).
 * 3. If review has text (title/body) -> screened via automated safety filter:
 *    - If flagged (profanity, PII, links) -> PENDING with specific flaggedReason.
 *    - If clean -> APPROVED (immediate publish).
 * 4. If rating only (no text, no media) -> APPROVED (immediate publish).
 */
export function evaluateReviewModeration(input: ReviewModerationInput): ReviewModerationDecision {
  const autoApprove = input.autoApproveEnabled ?? true;

  if (!autoApprove) {
    return {
      status: REVIEW_STATUS.PENDING,
      flaggedReason: null,
      flaggedAt: null,
      isAutoApproved: false,
    };
  }

  // Media (images/video) requires visual verification
  if (input.media && input.media.length > 0) {
    return {
      status: REVIEW_STATUS.PENDING,
      flaggedReason: 'MEDIA_VERIFICATION_REQUIRED: Review contains customer uploaded photos/video',
      flaggedAt: new Date(),
      isAutoApproved: false,
    };
  }

  const textToCheck = [input.title, input.body].filter(Boolean).join(' ').trim();

  // Rating only without text: completely clean
  if (!textToCheck) {
    return {
      status: REVIEW_STATUS.APPROVED,
      flaggedReason: null,
      flaggedAt: null,
      isAutoApproved: true,
    };
  }

  // Screen text
  const filterResult = screenContent(textToCheck);
  if (!filterResult.isClean) {
    return {
      status: REVIEW_STATUS.PENDING,
      flaggedReason: `SAFETY_FILTER_FLAG: ${filterResult.reasons.join(', ')}`,
      flaggedAt: new Date(),
      isAutoApproved: false,
    };
  }

  return {
    status: REVIEW_STATUS.APPROVED,
    flaggedReason: null,
    flaggedAt: null,
    isAutoApproved: true,
  };
}
