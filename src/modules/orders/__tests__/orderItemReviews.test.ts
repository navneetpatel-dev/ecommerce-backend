import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ORDER_STATUS } from '@core/constants/statuses';
import { canReviewLine } from '../orderItemReviews';

describe('canReviewLine', () => {
  const fresh = { productId: 'p-1', review: null, productReviewed: false };

  it('allows a delivered line with a known product and no review yet', () => {
    assert.equal(canReviewLine(ORDER_STATUS.DELIVERED, fresh), true);
  });

  it('refuses anything not yet delivered', () => {
    assert.equal(canReviewLine(ORDER_STATUS.SHIPPED, fresh), false);
    assert.equal(canReviewLine(ORDER_STATUS.CANCELLED, fresh), false);
  });

  it('refuses a line already reviewed or whose product is gone', () => {
    assert.equal(
      canReviewLine(ORDER_STATUS.DELIVERED, {
        productId: 'p-1',
        review: { id: 'r', rating: 4, status: 'PENDING' },
        productReviewed: true,
      }),
      false,
    );
    assert.equal(canReviewLine(ORDER_STATUS.DELIVERED, { productId: null, review: null, productReviewed: false }), false);
    assert.equal(canReviewLine(ORDER_STATUS.DELIVERED, { ...fresh, productReviewed: true }), false);
    assert.equal(canReviewLine(ORDER_STATUS.DELIVERED, undefined), false);
  });
});
