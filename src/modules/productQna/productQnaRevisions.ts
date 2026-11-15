import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errorMessages';
import { PRODUCT_ANSWER_STATUS, PRODUCT_QUESTION_STATUS } from '@core/constants/statuses';
import type { ProductQuestion } from '@database/models/productQuestion.model';
import type { ProductAnswer } from '@database/models/productAnswer.model';

/**
 * Same rule as reviews: an edit of something already published waits as a
 * `pendingRevision` while the published text stays up; approving swaps it in,
 * rejecting drops only the edit (and tells the author). Not yet published
 * (pending, or rejected and resubmitted) → edited in place, back to the queue.
 */
type Published = { status: string };
const isPublished = (row: Published) =>
  row.status === PRODUCT_QUESTION_STATUS.PUBLISHED || row.status === PRODUCT_ANSWER_STATUS.PUBLISHED;

export function questionEditUpdate(row: ProductQuestion, question: string, userId: string) {
  if (isPublished(row)) {
    return {
      pendingRevision: { question, submittedAt: new Date().toISOString() },
      revisionRejectedAt: null,
      updatedBy: userId,
    };
  }
  return {
    question,
    status: PRODUCT_QUESTION_STATUS.PENDING,
    editedAt: new Date(),
    pendingRevision: null,
    revisionRejectedAt: null,
    updatedBy: userId,
  };
}

export function answerEditUpdate(row: ProductAnswer, answer: string, userId: string) {
  if (isPublished(row)) {
    return {
      pendingRevision: { answer, submittedAt: new Date().toISOString() },
      revisionRejectedAt: null,
      updatedBy: userId,
    };
  }
  return {
    answer,
    status: PRODUCT_ANSWER_STATUS.PENDING,
    editedAt: new Date(),
    pendingRevision: null,
    revisionRejectedAt: null,
    updatedBy: userId,
  };
}

const discard = () => ({ pendingRevision: null, revisionRejectedAt: new Date() });

/**
 * A moderator's decision on a question. With an edit waiting, the decision is
 * about the edit; a question others have answered since keeps its wording
 * (approving would change what they answered), so that edit can only be rejected.
 */
export function moderateQuestionUpdate(row: ProductQuestion, approve: boolean, publishedAnswers: number) {
  const revision = row.pendingRevision;
  if (!revision) {
    return { status: approve ? PRODUCT_QUESTION_STATUS.PUBLISHED : PRODUCT_QUESTION_STATUS.REJECTED };
  }
  if (!approve) return discard();
  if (publishedAnswers > 0) {
    throw new ValidationError({ question: [ERROR_MESSAGES.QUESTION_HAS_ANSWERS] });
  }
  return { question: revision.question, editedAt: new Date(), pendingRevision: null, revisionRejectedAt: null };
}

export function moderateAnswerUpdate(row: ProductAnswer, approve: boolean) {
  const revision = row.pendingRevision;
  if (!revision) {
    return { status: approve ? PRODUCT_ANSWER_STATUS.PUBLISHED : PRODUCT_ANSWER_STATUS.REJECTED };
  }
  if (!approve) return discard();
  return { answer: revision.answer, editedAt: new Date(), pendingRevision: null, revisionRejectedAt: null };
}

/** For the author's own view only: their waiting edit, or that the last one was declined. */
export function ownerRevisionFields(plain: { pendingRevision?: unknown; revisionRejectedAt?: unknown }) {
  return {
    pendingRevision: plain.pendingRevision ?? null,
    revisionRejectedAt: plain.revisionRejectedAt ?? null,
  };
}
