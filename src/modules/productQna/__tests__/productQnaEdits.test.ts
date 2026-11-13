import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { ProductQuestion } from '@database/models/productQuestion.model';
import { ProductAnswer } from '@database/models/productAnswer.model';
import { PRODUCT_ANSWER_STATUS, PRODUCT_QUESTION_STATUS } from '@core/constants/statuses';
import { updateOwnAnswer, updateOwnQuestion } from '../productQnaEdits';

function row<T extends object>(fields: T) {
  const updates: Record<string, unknown>[] = [];
  return {
    updates,
    model: { ...fields, update: async (next: Record<string, unknown>) => (updates.push(next), { ...fields, ...next }) },
  };
}

describe('owner edits of questions and answers', () => {
  afterEach(() => mock.restoreAll());

  it('re-moderates an edited, still-unanswered question', async () => {
    const q = row({ id: 'q-1', userId: 'u-1' });
    mock.method(ProductQuestion, 'findByPk', async () => q.model as unknown as ProductQuestion);
    mock.method(ProductAnswer, 'count', async () => 0);
    await updateOwnQuestion('q-1', 'u-1', 'Is it waterproof in heavy rain?');
    assert.equal(q.updates[0]?.status, PRODUCT_QUESTION_STATUS.PENDING);
    assert.ok(q.updates[0]?.editedAt instanceof Date);
  });

  it("refuses someone else's question and a question that already has answers", async () => {
    mock.method(ProductQuestion, 'findByPk', async () => row({ id: 'q-1', userId: 'u-1' }).model as unknown as ProductQuestion);
    await assert.rejects(updateOwnQuestion('q-1', 'u-2', 'Is it waterproof?'), /your own question/);
    mock.method(ProductAnswer, 'count', async () => 2);
    await assert.rejects(updateOwnQuestion('q-1', 'u-1', 'Is it waterproof?'));
  });

  it('lets only the author edit an answer, and sends it back to moderation', async () => {
    const a = row({ id: 'a-1', authorId: 'u-1' });
    mock.method(ProductAnswer, 'findByPk', async () => a.model as unknown as ProductAnswer);
    await assert.rejects(updateOwnAnswer('a-1', 'u-2', 'Fits well'), /your own answer/);
    await updateOwnAnswer('a-1', 'u-1', 'Fits well');
    assert.equal(a.updates[0]?.status, PRODUCT_ANSWER_STATUS.PENDING);
  });
});
