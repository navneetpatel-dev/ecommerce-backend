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


const PUBLIC_QUERY = { page: 1, limit: 20, answered: 'all', sort: 'recent' } as const;

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
    // The shopper has received the product (C-01).
    mock.method(sequelize, 'query', async () => [{ found: 1 }]);

    await productQnaService.answerQuestion('q-1', 'u-1', null, 'An answer');
    assert.equal(created?.status, PRODUCT_ANSWER_STATUS.PENDING);
    assert.equal(created?.answer, 'An answer');
  });

  it('refuses a shopper answer from someone who has not received the product (C-01)', async () => {
    stubTransaction();
    mock.method(ProductQuestion, 'findByPk', async () => ({
      id: 'q-1',
      productId: 'p-1',
      status: PRODUCT_QUESTION_STATUS.PUBLISHED,
      product: { vendorId: 'v-1' },
    }) as unknown as ProductQuestion);
    const create = mock.method(ProductAnswer, 'create', async (fields: Record<string, unknown>) => fields as never);
    mock.method(sequelize, 'query', async () => []);

    await assert.rejects(
      () => productQnaService.answerQuestion('q-1', 'u-1', null, 'An answer'),
      (err: unknown) => err instanceof ForbiddenError,
    );
    assert.equal(create.mock.callCount(), 0);
  });

  it('lets the product\'s own vendor answer without a purchase', async () => {
    stubTransaction();
    mock.method(ProductQuestion, 'findByPk', async () => ({
      id: 'q-1',
      productId: 'p-1',
      status: PRODUCT_QUESTION_STATUS.PUBLISHED,
      product: { vendorId: 'v-1' },
    }) as unknown as ProductQuestion);
    let created: Record<string, unknown> | null = null;
    mock.method(ProductAnswer, 'create', async (fields: Record<string, unknown>) => {
      created = fields;
      return fields as never;
    });
    const query = mock.method(sequelize, 'query', async () => []);

    await productQnaService.answerQuestion('q-1', 'u-2', 'v-1', 'Seller answer');
    assert.equal(created?.authorType, 'VENDOR');
    assert.equal(query.mock.callCount(), 0);
  });

  it('public read carries each question its preview answer and published count, never the full thread', async () => {
    mock.method(productQnaRepository, 'summarizePublishedForProduct', async () => ({ total: 2, answered: 1 }));
    mock.method(productQnaRepository, 'findPublishedForProduct', async () => ({
      rows: [
        { id: 'q-1', productId: 'p-1', question: 'Is it good?', status: PRODUCT_QUESTION_STATUS.PUBLISHED, createdAt: new Date(), answerCount: '3' },
        { id: 'q-2', productId: 'p-1', question: 'Warranty?', status: PRODUCT_QUESTION_STATUS.PUBLISHED, createdAt: new Date(), answerCount: '0' },
      ],
      count: 2,
    }));
    const preview = mock.method(productQnaRepository, 'findPreviewAnswers', async () => [
      { id: 'a-pub', questionId: 'q-1', answer: 'Yes', status: PRODUCT_ANSWER_STATUS.PUBLISHED, authorType: 'VENDOR', authorId: 'v', authorName: null, createdAt: new Date(), editedAt: null },
    ]);

    const result = await productQnaService.getProductQuestions('p-1', PUBLIC_QUERY);
    assert.deepEqual(preview.mock.calls[0]?.arguments, [['q-1', 'q-2'], 1]);
    assert.equal(result.questions[0]?.answerCount, 3);
    assert.deepEqual(result.questions[0]?.answers.map((a) => a.id), ['a-pub']);
    assert.equal(result.questions[1]?.answerCount, 0);
    assert.deepEqual(result.questions[1]?.answers, []);
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

    mock.method(productQnaRepository, 'summarizePublishedForProduct', async () => ({ total: 1, answered: 1 }));
    mock.method(productQnaRepository, 'findPublishedForProduct', async () => ({
      rows: [
        {
          id: 'q-1',
          productId: 'p-1',
          question: 'Q',
          status: PRODUCT_QUESTION_STATUS.PUBLISHED,
          createdAt: new Date(),
          answerCount: '1',
        },
      ],
      count: 1,
    }));
    // The preview query returns PUBLISHED answers only (SQL-filtered).
    mock.method(productQnaRepository, 'findPreviewAnswers', async () =>
      status === PRODUCT_ANSWER_STATUS.PUBLISHED
        ? [{ id: 'a-1', questionId: 'q-1', answer: 'A', status, authorType: 'VENDOR', authorId: 'v', authorName: null, createdAt: new Date(), editedAt: null }]
        : [],
    );
    const result = await productQnaService.getProductQuestions('p-1', PUBLIC_QUERY);
    assert.equal(result.questions[0]?.answers[0]?.id, 'a-1');
  });
});
