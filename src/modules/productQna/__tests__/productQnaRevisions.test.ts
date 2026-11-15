import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProductAnswer } from '@database/models/productAnswer.model';
import type { ProductQuestion } from '@database/models/productQuestion.model';
import {
  answerEditUpdate,
  moderateAnswerUpdate,
  moderateQuestionUpdate,
  questionEditUpdate,
} from '../productQnaRevisions';

const answer = (fields: Partial<ProductAnswer>) => fields as ProductAnswer;
const question = (fields: Partial<ProductQuestion>) => fields as ProductQuestion;

describe('Q&A edits of published text wait beside it', () => {
  it('a published answer keeps its text; the edit waits as a revision', () => {
    const update = answerEditUpdate(answer({ status: 'PUBLISHED', answer: 'Old' }), 'New', 'u-1');
    assert.equal((update as { answer?: string }).answer, undefined, 'live text untouched');
    assert.equal((update as { status?: string }).status, undefined, 'stays published');
    assert.equal(update.pendingRevision?.answer, 'New');
    assert.equal(update.revisionRejectedAt, null);
  });

  it('a pending or rejected answer is edited in place and (re)queued', () => {
    for (const status of ['PENDING', 'REJECTED'] as const) {
      const update = answerEditUpdate(answer({ status }), 'New', 'u-1') as Record<string, unknown>;
      assert.equal(update.answer, 'New');
      assert.equal(update.status, 'PENDING');
      assert.equal(update.pendingRevision, null);
    }
  });

  it('approving an edit publishes it; rejecting drops only the edit', () => {
    const waiting = answer({ status: 'PUBLISHED', pendingRevision: { answer: 'New', submittedAt: 'x' } });
    const approved = moderateAnswerUpdate(waiting, true) as Record<string, unknown>;
    assert.equal(approved.answer, 'New');
    assert.equal(approved.pendingRevision, null);
    assert.equal(approved.status, undefined);
    const rejected = moderateAnswerUpdate(waiting, false) as Record<string, unknown>;
    assert.equal(rejected.pendingRevision, null);
    assert.ok(rejected.revisionRejectedAt instanceof Date);
    assert.equal(rejected.status, undefined, 'the published answer stays up');
  });

  it('without an edit waiting, moderation decides the status as before', () => {
    assert.deepEqual(moderateAnswerUpdate(answer({ status: 'PENDING' }), true), { status: 'PUBLISHED' });
    assert.deepEqual(moderateQuestionUpdate(question({ status: 'PENDING' }), false, 0), { status: 'REJECTED' });
  });

  it('a question edit cannot be approved once others have answered it', () => {
    const waiting = question({ status: 'PUBLISHED', pendingRevision: { question: 'New?', submittedAt: 'x' } });
    assert.throws(() => moderateQuestionUpdate(waiting, true, 2));
    assert.equal((moderateQuestionUpdate(waiting, true, 0) as Record<string, unknown>).question, 'New?');
    assert.equal((questionEditUpdate(question({ status: 'PUBLISHED' }), 'New?', 'u') as Record<string, unknown>).question, undefined);
  });
});
