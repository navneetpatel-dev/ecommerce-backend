import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { sequelize } from '@database/models';
import { ProductQuestion } from '@database/models/productQuestion.model';
import { ProductAnswer } from '@database/models/productAnswer.model';
import { productQnaRepository } from '../productQna.repository';
import { productQnaService } from '../productQna.service';
import { ValidationError } from '@core/errors/ValidationError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import {
  PRODUCT_ANSWER_STATUS,
  PRODUCT_QUESTION_STATUS,
  ROLES,
} from '@core/constants/statuses';

describe('ProductQnaService moderation', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  function stubTransaction() {
    mock.method(sequelize, 'transaction', async (callback: (t: unknown) => Promise<unknown>) => {
      return callback({});
    });
  }

  it('rejects answering a PENDING or REJECTED question', async () => {
    stubTransaction();
    mock.method(ProductQuestion, 'findByPk', async () => ({
      id: 'q-1',
      status: PRODUCT_QUESTION_STATUS.PENDING,
      product: { vendorId: 'v-1' },
    }) as unknown as ProductQuestion);

    await assert.rejects(
      () => productQnaService.answerQuestion('q-1', 'u-1', null, 'An answer'),
      (err: unknown) => err instanceof ValidationError,
    );

    mock.restoreAll();
    stubTransaction();
    mock.method(ProductQuestion, 'findByPk', async () => ({
      id: 'q-2',
      status: PRODUCT_QUESTION_STATUS.REJECTED,
      product: { vendorId: 'v-1' },
    }) as unknown as ProductQuestion);

    await assert.rejects(
      () => productQnaService.answerQuestion('q-2', 'u-1', null, 'An answer'),
      (err: unknown) => err instanceof ValidationError,
    );
  });

  it('creates a PENDING answer on a PUBLISHED question', async () => {
    stubTransaction();
    mock.method(ProductQuestion, 'findByPk', async () => ({
      id: 'q-1',
      status: PRODUCT_QUESTION_STATUS.PUBLISHED,
      product: { vendorId: 'v-1' },
    }) as unknown as ProductQuestion);

    let created: Record<string, unknown> | null = null;
    mock.method(ProductAnswer, 'create', async (fields: Record<string, unknown>) => {
      created = fields;
      return fields as never;
    });

    await productQnaService.answerQuestion('q-1', 'u-1', null, 'An answer');
    assert.equal(created?.status, PRODUCT_ANSWER_STATUS.PENDING);
    assert.equal(created?.answer, 'An answer');
  });

  it('public read only includes PUBLISHED answers', async () => {
    mock.method(productQnaRepository, 'findPublishedForProduct', async () => ({
      rows: [
        {
          id: 'q-1',
          productId: 'p-1',
          question: 'Is it good?',
          status: PRODUCT_QUESTION_STATUS.PUBLISHED,
          createdAt: new Date(),
          answers: [
            { id: 'a-pub', answer: 'Yes', status: PRODUCT_ANSWER_STATUS.PUBLISHED, authorType: 'VENDOR' },
            { id: 'a-pend', answer: 'Soon', status: PRODUCT_ANSWER_STATUS.PENDING, authorType: 'CUSTOMER' },
            { id: 'a-rej', answer: 'No', status: PRODUCT_ANSWER_STATUS.REJECTED, authorType: 'CUSTOMER' },
          ],
        },
      ],
      count: 1,
    }));

    const result = await productQnaService.getProductQuestions('p-1', { page: 1, limit: 20 });
    assert.equal(result.questions[0]?.answers.length, 1);
    assert.equal(result.questions[0]?.answers[0]?.id, 'a-pub');
  });

  it('lets the author or a moderator delete an answer, but not another customer', async () => {
    const answer = {
      id: 'a-1',
      authorId: 'author-1',
      destroy: async () => undefined,
    };

    mock.method(ProductAnswer, 'findByPk', async () => answer as unknown as ProductAnswer);
    mock.method(sequelize, 'query', async () => []);

    await productQnaService.deleteAnswer('a-1', {
      id: 'author-1',
      roleId: 'r-1',
      role: { name: ROLES.CUSTOMER },
    });

    await assert.rejects(
      () =>
        productQnaService.deleteAnswer('a-1', {
          id: 'other-1',
          roleId: 'r-2',
          role: { name: ROLES.CUSTOMER },
        }),
      (err: unknown) => err instanceof ForbiddenError,
    );

    await productQnaService.deleteAnswer('a-1', {
      id: 'admin-1',
      roleId: 'r-admin',
      role: { name: ROLES.SUPER_ADMIN },
    });
  });

  it('moderating an answer to PUBLISHED makes it visible on the public read path', async () => {
    let status = PRODUCT_ANSWER_STATUS.PENDING;
    mock.method(ProductAnswer, 'findByPk', async () => ({
      id: 'a-1',
      update: async (fields: { status: string }) => {
        status = fields.status as typeof status;
        return { id: 'a-1', status };
      },
    }) as unknown as ProductAnswer);

    await productQnaService.moderateAnswer('a-1', PRODUCT_ANSWER_STATUS.PUBLISHED);
    assert.equal(status, PRODUCT_ANSWER_STATUS.PUBLISHED);

    mock.method(productQnaRepository, 'findPublishedForProduct', async () => ({
      rows: [
        {
          id: 'q-1',
          productId: 'p-1',
          question: 'Q',
          status: PRODUCT_QUESTION_STATUS.PUBLISHED,
          createdAt: new Date(),
          answers: [{ id: 'a-1', answer: 'A', status, authorType: 'VENDOR' }],
        },
      ],
      count: 1,
    }));
    const result = await productQnaService.getProductQuestions('p-1', { page: 1, limit: 20 });
    assert.equal(result.questions[0]?.answers[0]?.id, 'a-1');
  });
});
