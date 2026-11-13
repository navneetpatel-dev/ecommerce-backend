import { NotFoundError } from '@core/errors/NotFoundError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { REVIEW_STATUS } from '@core/constants/statuses';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { Review } from '@database/models/review.model';
import { ReviewVote } from '@database/models/reviewVote.model';
import { sequelize } from '@database/models';
import type { Transaction } from 'sequelize';

export type ReviewVoteValue = 'HELPFUL' | 'UNHELPFUL';

const counter = (vote: ReviewVoteValue) => (vote === 'HELPFUL' ? 'helpfulCount' : 'unhelpfulCount');

/** A review plus the caller's own vote on it, so the page can show which one is theirs. */
export type ReviewWithMyVote = ReturnType<Review['get']> & { myVote: ReviewVoteValue | null };

function withMyVote(review: Review, myVote: ReviewVoteValue | null): ReviewWithMyVote {
  return { ...review.get({ plain: true }), myVote };
}

/** Only someone else's published review can be voted on. */
async function lockVotableReview(reviewId: string, userId: string, t: Transaction) {
  const review = await Review.findByPk(reviewId, { transaction: t, lock: t.LOCK.UPDATE });
  // A pending review does not exist for shoppers.
  if (!review || review.status !== REVIEW_STATUS.APPROVED) throw new NotFoundError('Review');
  if (review.userId === userId) throw new ForbiddenError(ERROR_MESSAGES.REVIEW_VOTE_OWN);
  return review;
}

/**
 * Helpful / Not helpful. Casting the same vote again changes nothing (a double
 * click counts once); the other vote moves it. Clearing is `clearReviewVote`.
 */
export function castReviewVote(reviewId: string, userId: string, vote: ReviewVoteValue) {
  return sequelize.transaction(async (t) => {
    const review = await lockVotableReview(reviewId, userId, t);
    const [reviewVote, created] = await ReviewVote.findOrCreate({
      where: { reviewId, userId },
      defaults: { reviewId, userId, vote },
      transaction: t,
    });
    // Read the old vote before changing it: comparing after the update made a
    // switch decrement the old counter but never increment the new one.
    const previous = created ? null : (reviewVote.vote as ReviewVoteValue);
    if (previous !== vote) {
      if (previous) {
        await reviewVote.update({ vote }, { transaction: t });
        await review.decrement(counter(previous), { transaction: t });
      }
      await review.increment(counter(vote), { transaction: t });
    }
    return withMyVote(await review.reload({ transaction: t }), vote);
  });
}

/** Takes the caller's vote back (clicking their highlighted vote again). */
export function clearReviewVote(reviewId: string, userId: string) {
  return sequelize.transaction(async (t) => {
    const review = await lockVotableReview(reviewId, userId, t);
    const existing = await ReviewVote.findOne({ where: { reviewId, userId }, transaction: t });
    if (existing) {
      await existing.destroy({ transaction: t, force: true });
      await review.decrement(counter(existing.vote as ReviewVoteValue), { transaction: t });
    }
    return withMyVote(await review.reload({ transaction: t }), null);
  });
}

/** The viewer's vote on each of these reviews (reviews they did not vote on are absent). */
export async function findViewerVotes(reviewIds: string[], userId: string) {
  if (!reviewIds.length) return new Map<string, ReviewVoteValue>();
  const rows = await ReviewVote.findAll({
    where: { reviewId: reviewIds, userId },
    attributes: ['reviewId', 'vote'],
  });
  return new Map(rows.map((row) => [row.reviewId, row.vote as ReviewVoteValue]));
}
