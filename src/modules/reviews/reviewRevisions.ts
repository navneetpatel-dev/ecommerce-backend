import { REVIEW_STATUS } from '@core/constants/statuses';
import type { Review, ReviewMediaItem, ReviewRevision } from '@database/models/review.model';
import { evaluateReviewModeration } from './reviewModerationDecision';

/**
 * Edits of an approved review wait as a `pendingRevision` beside the live one:
 * shoppers keep seeing (and voting on) the approved text, stars and photos until
 * a moderator approves the edit (it replaces the live version) or rejects it
 * (only the edit is dropped). A review that is not live yet — pending, or
 * rejected and being resubmitted — has nothing public to protect, so it is
 * edited in place and evaluated through automated moderation.
 */
export interface ReviewEdit {
  rating: number;
  title?: string | null;
  body: string;
  /** Resolved photos/video; undefined = unchanged. */
  media?: ReviewMediaItem[];
}

export const isLiveReview = (review: Pick<Review, 'status'>) => review.status === REVIEW_STATUS.APPROVED;

/** The columns an owner edit writes. */
export function reviewEditUpdate(review: Review, edit: ReviewEdit, userId: string, autoApproveEnabled: boolean = true) {
  const title = edit.title?.trim() ? edit.title : null;
  if (isLiveReview(review)) {
    const revision: ReviewRevision = {
      rating: edit.rating,
      title,
      body: edit.body,
      // Unchanged photos: whatever the author last proposed, else the live set.
      media: edit.media ?? review.pendingRevision?.media ?? review.media ?? [],
      submittedAt: new Date().toISOString(),
    };
    return { pendingRevision: revision, revisionRejectedAt: null, updatedBy: userId };
  }

  const moderation = evaluateReviewModeration({
    rating: edit.rating,
    title,
    body: edit.body,
    media: edit.media,
    autoApproveEnabled,
  });

  return {
    rating: edit.rating,
    title,
    body: edit.body,
    ...(edit.media ? { media: edit.media } : {}),
    status: moderation.status,
    flaggedReason: moderation.flaggedReason,
    flaggedAt: moderation.flaggedAt,
    editedAt: new Date(),
    pendingRevision: null,
    revisionRejectedAt: null,
    updatedBy: userId,
  };
}

/** Photos an edit may keep: the live ones and any the author already proposed. */
export function editableMediaBase(review: Review): { id: string; media: ReviewMediaItem[] } {
  const seen = new Map<string, ReviewMediaItem>();
  for (const item of [...(review.media ?? []), ...(review.pendingRevision?.media ?? [])]) {
    seen.set(item.url, item);
  }
  return { id: review.id, media: [...seen.values()] };
}

/** Approving an edit: it becomes the live review, marked as edited. */
export function applyRevisionUpdate(revision: ReviewRevision) {
  return {
    rating: revision.rating,
    title: revision.title,
    body: revision.body,
    media: revision.media,
    editedAt: new Date(),
    pendingRevision: null,
    revisionRejectedAt: null,
  };
}

/** Rejecting an edit: the approved version stays; the author is told the edit was declined. */
export const discardRevisionUpdate = () => ({ pendingRevision: null, revisionRejectedAt: new Date() });

type PlainReview = Record<string, unknown> & { pendingRevision?: unknown; revisionRejectedAt?: unknown };

/** What anyone but the author (and moderators) may see: never the unapproved edit. */
export function withoutRevision<T extends PlainReview>(review: T): Omit<T, 'pendingRevision' | 'revisionRejectedAt'> {
  const { pendingRevision: _pending, revisionRejectedAt: _rejected, ...rest } = review;
  return rest;
}

interface ModerationRow {
  id: string;
  status: string;
  rating: number;
  title: string | null;
  body: string;
  media: ReviewMediaItem[] | null;
  createdAt: Date;
  pendingRevision: ReviewRevision | null;
  product?: { name: string } | null;
  user?: { name: string } | null;
}

/**
 * A moderation row. An edit of an approved review shows the proposed version
 * (what approving would publish) with the live one as `previous*` beside it.
 */
export function serializePendingReview(row: Review) {
  const plain = row.get({ plain: true }) as unknown as ModerationRow;
  const revision = plain.pendingRevision;
  const proposed = revision ?? plain;
  return {
    id: plain.id,
    submission: revision ? 'EDIT' : 'NEW',
    rating: proposed.rating,
    title: proposed.title,
    body: proposed.body,
    media: proposed.media ?? [],
    status: plain.status,
    createdAt: revision?.submittedAt ?? plain.createdAt,
    productName: plain.product?.name ?? null,
    customerName: plain.user?.name ?? null,
    previousRating: revision ? plain.rating : null,
    previousTitle: revision ? plain.title : null,
    previousBody: revision ? plain.body : null,
    vendorResponse: (plain as any).vendorResponse ?? null,
    vendorRespondedAt: (plain as any).vendorRespondedAt ?? null,
    flaggedReason: (plain as any).flaggedReason ?? null,
    flaggedAt: (plain as any).flaggedAt ?? null,
  };
}
