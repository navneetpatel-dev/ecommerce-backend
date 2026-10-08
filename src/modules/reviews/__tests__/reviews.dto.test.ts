import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CreateReviewSchema, RespondReviewSchema, VoteReviewSchema } from '../reviews.dto';

const UUID = '8bdf2ea7-6f4f-4b1b-9d7a-0f0f5b1a2c3d';

function review(overrides: Record<string, unknown> = {}) {
  return {
    orderItemId: UUID,
    productId: UUID,
    rating: 5,
    body: 'Great product',
    ...overrides,
  };
}

describe('reviews DTO schemas', () => {
  it('rating must be a whole number between 1 and 5', () => {
    for (const rating of [0, 6, 3.5, -1]) {
      assert.equal(
        CreateReviewSchema.safeParse(review({ rating })).success,
        false,
        `expected rating ${rating} to be rejected`,
      );
    }
    for (const rating of [1, 3, 5]) {
      assert.equal(CreateReviewSchema.safeParse(review({ rating })).success, true);
    }
  });

  it('requires both orderItemId and productId as uuids', () => {
    assert.equal(CreateReviewSchema.safeParse(review({ orderItemId: 'x' })).success, false);
    assert.equal(CreateReviewSchema.safeParse(review({ productId: '' })).success, false);
  });

  it('body must be non-empty', () => {
    assert.equal(CreateReviewSchema.safeParse(review({ body: '' })).success, false);
  });

  it('votes are restricted to HELPFUL / UNHELPFUL', () => {
    assert.equal(VoteReviewSchema.safeParse({ vote: 'HELPFUL' }).success, true);
    assert.equal(VoteReviewSchema.safeParse({ vote: 'UNHELPFUL' }).success, true);
    assert.equal(VoteReviewSchema.safeParse({ vote: 'MAYBE' }).success, false);
  });

  it('vendor responses must be non-empty', () => {
    assert.equal(RespondReviewSchema.safeParse({ response: '' }).success, false);
    assert.equal(RespondReviewSchema.safeParse({ response: 'Thanks!' }).success, true);
  });
});
