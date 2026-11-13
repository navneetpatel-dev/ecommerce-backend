import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProductReviewsQuerySchema } from '../reviews.dto';
import { ProductQuestionsQuerySchema } from '../../productQna/productQna.dto';

describe('PDP list query schemas', () => {
  it('reviews: defaults to the first page sorted by most recent, no filters', () => {
    const query = ProductReviewsQuerySchema.parse({});
    assert.equal(query.page, 1);
    assert.equal(query.sort, 'recent');
    assert.equal(query.rating, undefined);
    assert.equal(query.withMedia, undefined);
  });

  it('reviews: coerces query-string filters and rejects out-of-range stars', () => {
    const query = ProductReviewsQuerySchema.parse({ rating: '4', withMedia: 'true', sort: 'helpful', limit: '5' });
    assert.equal(query.rating, 4);
    assert.equal(query.withMedia, true);
    assert.equal(query.limit, 5);
    assert.throws(() => ProductReviewsQuerySchema.parse({ rating: '6' }));
    assert.throws(() => ProductReviewsQuerySchema.parse({ sort: 'cheapest' }));
  });

  it('questions: trims search, defaults to all/recent, rejects unknown filters', () => {
    const query = ProductQuestionsQuerySchema.parse({ q: '  warranty  ' });
    assert.equal(query.q, 'warranty');
    assert.equal(query.answered, 'all');
    assert.equal(query.sort, 'recent');
    assert.throws(() => ProductQuestionsQuerySchema.parse({ answered: 'maybe' }));
    assert.throws(() => ProductQuestionsQuerySchema.parse({ q: 'x'.repeat(101) }));
  });
});

describe('Q&A text limits', () => {
  it('questions: 10–300 trimmed characters', async () => {
    const { AskQuestionSchema, UpdateQuestionSchema } = await import('../../productQna/productQna.dto');
    const productId = '8bdf2ea7-6f4f-4b1b-9d7a-0f0f5b1a2c3d';
    assert.equal(AskQuestionSchema.safeParse({ productId, question: 'Too short' }).success, false);
    assert.equal(AskQuestionSchema.safeParse({ productId, question: 'Does it fit true to size?' }).success, true);
    assert.equal(UpdateQuestionSchema.safeParse({ question: 'q'.repeat(301) }).success, false);
  });

  it('answers: 3–1000 trimmed characters', async () => {
    const { AnswerQuestionSchema } = await import('../../productQna/productQna.dto');
    assert.equal(AnswerQuestionSchema.safeParse({ answer: '  ok ' }).success, false);
    assert.equal(AnswerQuestionSchema.safeParse({ answer: 'Yes' }).success, true);
    assert.equal(AnswerQuestionSchema.safeParse({ answer: 'a'.repeat(1001) }).success, false);
  });
});
