import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { REVIEW_STATUS } from '@core/constants/statuses';
import { evaluateReviewModeration } from '../reviewModerationDecision';

describe('evaluateReviewModeration', () => {
  it('auto-approves rating-only reviews', () => {
    const decision = evaluateReviewModeration({
      rating: 5,
      title: null,
      body: '',
      media: [],
      autoApproveEnabled: true,
    });

    assert.equal(decision.status, REVIEW_STATUS.APPROVED);
    assert.equal(decision.isAutoApproved, true);
    assert.equal(decision.flaggedReason, null);
  });

  it('auto-approves clean text reviews without media', () => {
    const decision = evaluateReviewModeration({
      rating: 4,
      title: 'Very comfortable',
      body: 'I bought these for daily wear and they fit great. High quality material.',
      media: [],
      autoApproveEnabled: true,
    });

    assert.equal(decision.status, REVIEW_STATUS.APPROVED);
    assert.equal(decision.isAutoApproved, true);
    assert.equal(decision.flaggedReason, null);
  });

  it('holds reviews with uploaded photos or videos in PENDING', () => {
    const decision = evaluateReviewModeration({
      rating: 5,
      title: 'Look at the photo',
      body: 'Item is as described',
      media: [{ url: 'https://example.com/photo.jpg', type: 'IMAGE', durationSeconds: null }],
      autoApproveEnabled: true,
    });

    assert.equal(decision.status, REVIEW_STATUS.PENDING);
    assert.equal(decision.isAutoApproved, false);
    assert.ok(decision.flaggedReason?.includes('MEDIA_VERIFICATION_REQUIRED'));
    assert.ok(decision.flaggedAt instanceof Date);
  });

  it('holds reviews with PII, phone numbers, or links in PENDING with reasons', () => {
    const decision = evaluateReviewModeration({
      rating: 1,
      title: 'Bad product',
      body: 'Contact me at 9876543210 for refund or visit www.cheatstore.com',
      media: [],
      autoApproveEnabled: true,
    });

    assert.equal(decision.status, REVIEW_STATUS.PENDING);
    assert.equal(decision.isAutoApproved, false);
    assert.ok(decision.flaggedReason?.includes('SAFETY_FILTER_FLAG'));
    assert.ok(decision.flaggedAt instanceof Date);
  });

  it('holds reviews with profanity in PENDING with reasons', () => {
    const decision = evaluateReviewModeration({
      rating: 1,
      title: 'Scam',
      body: 'Fucking useless seller',
      media: [],
      autoApproveEnabled: true,
    });

    assert.equal(decision.status, REVIEW_STATUS.PENDING);
    assert.equal(decision.isAutoApproved, false);
    assert.ok(decision.flaggedReason?.includes('SAFETY_FILTER_FLAG'));
  });

  it('defaults to PENDING when autoApproveEnabled is false', () => {
    const decision = evaluateReviewModeration({
      rating: 5,
      title: 'Perfect',
      body: 'Excellent quality',
      media: [],
      autoApproveEnabled: false,
    });

    assert.equal(decision.status, REVIEW_STATUS.PENDING);
    assert.equal(decision.isAutoApproved, false);
    assert.equal(decision.flaggedReason, null);
  });
});
