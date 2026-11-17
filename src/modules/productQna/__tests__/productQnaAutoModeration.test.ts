import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { ProductQuestion } from '@database/models/productQuestion.model';
import { Product } from '@database/models/product.model';
import { productQnaService } from '../productQna.service';
import { PRODUCT_QUESTION_STATUS } from '@core/constants/statuses';
import { settingsService } from '@modules/settings/settings.service';

describe('ProductQnaService auto moderation', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('auto-publishes clean questions when autoApproveQuestions is enabled', async () => {
    mock.method(
      settingsService,
      'getPlatformSettings',
      async () =>
        ({
          autoApproveQuestions: true,
        }) as any,
    );

    mock.method(
      Product,
      'scope',
      () =>
        ({
          findByPk: async () => ({ id: 'p-1', name: 'Running Shoes' }),
        }) as any,
    );

    let createdFields: Record<string, unknown> | null = null;
    mock.method(ProductQuestion, 'create', async (fields: Record<string, unknown>) => {
      createdFields = fields;
      return fields as never;
    });

    await productQnaService.askQuestion('u-1', {
      productId: 'p-1',
      question: 'Is this shoe suitable for long-distance marathon running?',
    });

    assert.equal(createdFields?.status, PRODUCT_QUESTION_STATUS.PUBLISHED);
    assert.equal(createdFields?.productId, 'p-1');
  });

  it('holds questions with profanity in PENDING status', async () => {
    mock.method(
      settingsService,
      'getPlatformSettings',
      async () =>
        ({
          autoApproveQuestions: true,
        }) as any,
    );

    mock.method(
      Product,
      'scope',
      () =>
        ({
          findByPk: async () => ({ id: 'p-1', name: 'Running Shoes' }),
        }) as any,
    );

    let createdFields: Record<string, unknown> | null = null;
    mock.method(ProductQuestion, 'create', async (fields: Record<string, unknown>) => {
      createdFields = fields;
      return fields as never;
    });

    await productQnaService.askQuestion('u-1', {
      productId: 'p-1',
      question: 'This is a fucking scam, don’t buy',
    });

    assert.equal(createdFields?.status, PRODUCT_QUESTION_STATUS.PENDING);
  });

  it('holds questions with phone numbers or external links in PENDING status', async () => {
    mock.method(
      settingsService,
      'getPlatformSettings',
      async () =>
        ({
          autoApproveQuestions: true,
        }) as any,
    );

    mock.method(
      Product,
      'scope',
      () =>
        ({
          findByPk: async () => ({ id: 'p-1', name: 'Running Shoes' }),
        }) as any,
    );

    let createdFields: Record<string, unknown> | null = null;
    mock.method(ProductQuestion, 'create', async (fields: Record<string, unknown>) => {
      createdFields = fields;
      return fields as never;
    });

    await productQnaService.askQuestion('u-1', {
      productId: 'p-1',
      question: 'Call me at 9876543210 or visit https://deals.example.com',
    });

    assert.equal(createdFields?.status, PRODUCT_QUESTION_STATUS.PENDING);
  });

  it('holds clean questions in PENDING if autoApproveQuestions is disabled by admin', async () => {
    mock.method(
      settingsService,
      'getPlatformSettings',
      async () =>
        ({
          autoApproveQuestions: false,
        }) as any,
    );

    mock.method(
      Product,
      'scope',
      () =>
        ({
          findByPk: async () => ({ id: 'p-1', name: 'Running Shoes' }),
        }) as any,
    );

    let createdFields: Record<string, unknown> | null = null;
    mock.method(ProductQuestion, 'create', async (fields: Record<string, unknown>) => {
      createdFields = fields;
      return fields as never;
    });

    await productQnaService.askQuestion('u-1', {
      productId: 'p-1',
      question: 'Is this shoe suitable for long-distance marathon running?',
    });

    assert.equal(createdFields?.status, PRODUCT_QUESTION_STATUS.PENDING);
  });
});
