import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sequelize } from '@database/models';
import { Review } from '@database/models/review.model';
import { reviewsService } from '../reviews.service';

/** Edit → still live → reject (edit dropped) → edit → approve (edit live). Restores the row. */
describe('editing an approved review', () => {
  it('keeps the approved version public until the edit is approved', async (t) => {
    try {
      await sequelize.authenticate();
    } catch {
      return t.skip('database unavailable');
    }
    const review = await Review.findOne({ where: { status: 'APPROVED', pendingRevision: null } });
    if (!review) return t.skip('no approved review');
    const snapshot = review.get({ plain: true });
    const publicIds = async () => {
      const page = await reviewsService.getProductReviewPage(review.productId, { page: 1, limit: 100, sort: 'recent' } as never);
      return page.reviews as Array<Record<string, unknown>>;
    };
    try {
      await reviewsService.updateOwnReview(review.id, review.userId, {
        rating: 1,
        title: 'Changed my mind',
        body: 'This is the edited body text for the revision test.',
      } as never);
      let row = await Review.findByPk(review.id);
      assert.equal(row!.status, 'APPROVED', 'still live');
      assert.equal(row!.body, snapshot.body, 'shoppers still see the approved text');
      assert.equal(row!.pendingRevision?.rating, 1);
      const listed = (await publicIds()).find((r) => r.id === review.id);
      if (listed) {
        assert.equal(listed.body, snapshot.body);
        assert.equal('pendingRevision' in listed, false, 'the edit never reaches other shoppers');
      }

      await reviewsService.rejectReview(review.id);
      row = await Review.findByPk(review.id);
      assert.equal(row!.status, 'APPROVED');
      assert.equal(row!.pendingRevision, null);
      assert.ok(row!.revisionRejectedAt, 'the author is told the edit was declined');
      assert.equal(row!.body, snapshot.body);

      await reviewsService.updateOwnReview(review.id, review.userId, {
        rating: 2,
        title: null,
        body: 'Second edit of the body, this time approved.',
      } as never);
      row = await Review.findByPk(review.id);
      assert.equal(row!.revisionRejectedAt, null, 'a new edit clears the declined note');
      await reviewsService.approveReview(review.id);
      row = await Review.findByPk(review.id);
      assert.equal(row!.body, 'Second edit of the body, this time approved.');
      assert.equal(row!.rating, 2);
      assert.equal(row!.pendingRevision, null);
      assert.ok(row!.editedAt);
    } finally {
      await Review.update(
        {
          rating: snapshot.rating,
          title: snapshot.title,
          body: snapshot.body,
          media: snapshot.media,
          status: snapshot.status,
          editedAt: snapshot.editedAt,
          pendingRevision: null,
          revisionRejectedAt: null,
        },
        { where: { id: review.id } },
      );
      await reviewsService.approveReview(review.id); // recalculates the product rating
    }
  });
});
