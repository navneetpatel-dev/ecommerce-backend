import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@database/models';
import { Review } from '@database/models/review.model';
import { ReviewVote } from '@database/models/reviewVote.model';
import { reviewsService } from '../reviews.service';

const counts = async (id: string) => {
  const row = await Review.findByPk(id);
  return [row!.helpfulCount, row!.unhelpfulCount];
};

describe('review votes (B-46)', () => {
  it('moves the vote between Helpful and Not helpful, and refuses own and unpublished reviews', async (t) => {
    try {
      await sequelize.authenticate();
    } catch {
      return t.skip('database unavailable');
    }
    const [pick] = await sequelize.query<{ id: string; author: string; voter: string; pending: string | null }>(
      `SELECT r.id, r."userId" AS author,
         (SELECT u.id FROM users u WHERE u.id <> r."userId"
            AND NOT EXISTS (SELECT 1 FROM review_votes v WHERE v."reviewId" = r.id AND v."userId" = u.id) LIMIT 1) AS voter,
         (SELECT p.id FROM reviews p WHERE p.status <> 'APPROVED' LIMIT 1) AS pending
       FROM reviews r WHERE r.status = 'APPROVED' LIMIT 1`,
      { type: QueryTypes.SELECT },
    );
    if (!pick?.voter) return t.skip('no approved review to vote on');
    const [helpful, unhelpful] = await counts(pick.id);
    try {
      await reviewsService.voteReview(pick.id, pick.voter, 'HELPFUL');
      assert.deepEqual(await counts(pick.id), [helpful + 1, unhelpful]);
      await reviewsService.voteReview(pick.id, pick.voter, 'HELPFUL');
      assert.deepEqual(await counts(pick.id), [helpful + 1, unhelpful], 'a second click counts once');
      await reviewsService.voteReview(pick.id, pick.voter, 'UNHELPFUL');
      assert.deepEqual(await counts(pick.id), [helpful, unhelpful + 1], 'switching moves the vote');
      await reviewsService.voteReview(pick.id, pick.voter, 'HELPFUL');
      assert.deepEqual(await counts(pick.id), [helpful + 1, unhelpful]);

      await assert.rejects(reviewsService.voteReview(pick.id, pick.author, 'HELPFUL'), { statusCode: 403 });
      if (pick.pending) {
        await assert.rejects(reviewsService.voteReview(pick.pending, pick.voter, 'HELPFUL'), { statusCode: 404 });
      }
    } finally {
      await ReviewVote.destroy({ where: { reviewId: pick.id, userId: pick.voter }, force: true } as never);
      await Review.update({ helpfulCount: helpful, unhelpfulCount: unhelpful }, { where: { id: pick.id } });
    }
  });
});
