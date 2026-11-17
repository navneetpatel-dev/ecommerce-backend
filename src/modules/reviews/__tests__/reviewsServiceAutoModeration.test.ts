import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Review } from '@database/models/review.model';
import { OrderItem } from '@database/models/orderItem.model';
import { SubOrder } from '@database/models/subOrder.model';
import { reviewsService } from '../reviews.service';
import { REVIEW_STATUS, ORDER_STATUS } from '@core/constants/statuses';
import { settingsService } from '@modules/settings/settings.service';
import { sequelize } from '@database/models';

describe('reviewsService auto moderation', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  function stubOrderEligibility() {
    mock.method(sequelize, 'transaction', async (callback: (t: unknown) => Promise<unknown>) => callback({ afterCommit: () => undefined }));
    mock.method(
      OrderItem,
      'findByPk',
      async () =>
        ({
          id: 'oi-1',
          subOrder: {
            order: { userId: 'u-1' },
            status: ORDER_STATUS.DELIVERED,
          },
          variant: { productId: 'p-1' },
        }) as any,
    );
    mock.method(Review, 'findOne', async () => null);
    mock.method(Review, 'count', async () => 0);
    mock.method(reviewsService as any, 'recalculateProductRating', async () => {});
  }

  it('auto-approves a verified buyer rating-only review', async () => {
    stubOrderEligibility();
    mock.method(
      settingsService,
      'getPlatformSettings',
      async () =>
        ({
          autoApproveReviews: true,
        }) as any,
    );

    let createdFields: Record<string, unknown> | null = null;
    mock.method(Review, 'create', async (fields: Record<string, unknown>) => {
      createdFields = fields;
      return fields as never;
    });

    await reviewsService.createReview('u-1', {
      orderItemId: 'oi-1',
      productId: 'p-1',
      rating: 5,
      title: null,
      body: '',
    });

    assert.equal(createdFields?.status, REVIEW_STATUS.APPROVED);
    assert.equal(createdFields?.flaggedReason, null);
  });

  it('auto-approves a clean text review', async () => {
    stubOrderEligibility();
    mock.method(
      settingsService,
      'getPlatformSettings',
      async () =>
        ({
          autoApproveReviews: true,
        }) as any,
    );

    let createdFields: Record<string, unknown> | null = null;
    mock.method(Review, 'create', async (fields: Record<string, unknown>) => {
      createdFields = fields;
      return fields as never;
    });

    await reviewsService.createReview('u-1', {
      orderItemId: 'oi-1',
      productId: 'p-1',
      rating: 4,
      title: 'Great fit',
      body: 'I really love the comfort and build of these shoes.',
    });

    assert.equal(createdFields?.status, REVIEW_STATUS.APPROVED);
    assert.equal(createdFields?.flaggedReason, null);
  });

  it('holds a review with profanity in PENDING with safety flag', async () => {
    stubOrderEligibility();
    mock.method(
      settingsService,
      'getPlatformSettings',
      async () =>
        ({
          autoApproveReviews: true,
        }) as any,
    );

    let createdFields: Record<string, unknown> | null = null;
    mock.method(Review, 'create', async (fields: Record<string, unknown>) => {
      createdFields = fields;
      return fields as never;
    });

    await reviewsService.createReview('u-1', {
      orderItemId: 'oi-1',
      productId: 'p-1',
      rating: 1,
      title: 'Scam',
      body: 'Fucking terrible seller',
    });

    assert.equal(createdFields?.status, REVIEW_STATUS.PENDING);
    assert.ok(String(createdFields?.flaggedReason).includes('SAFETY_FILTER_FLAG'));
  });

  it('holds a review in PENDING when autoApproveReviews is false', async () => {
    stubOrderEligibility();
    mock.method(
      settingsService,
      'getPlatformSettings',
      async () =>
        ({
          autoApproveReviews: false,
        }) as any,
    );

    let createdFields: Record<string, unknown> | null = null;
    mock.method(Review, 'create', async (fields: Record<string, unknown>) => {
      createdFields = fields;
      return fields as never;
    });

    await reviewsService.createReview('u-1', {
      orderItemId: 'oi-1',
      productId: 'p-1',
      rating: 5,
      title: 'Great',
      body: 'Loved it',
    });

    assert.equal(createdFields?.status, REVIEW_STATUS.PENDING);
    assert.equal(createdFields?.flaggedReason, null);
  });
});
