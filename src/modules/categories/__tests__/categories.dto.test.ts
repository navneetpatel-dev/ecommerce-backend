import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CreateCategoryAttributeSchema,
  CreateCategorySchema,
  ReorderCategoriesSchema,
  UpdateCategorySchema,
} from '../categories.dto';

const UUID = '8bdf2ea7-6f4f-4b1b-9d7a-0f0f5b1a2c3d';

describe('categories DTO schemas', () => {
  it('accepts a minimal create payload and applies no implicit fields', () => {
    const parsed = CreateCategorySchema.parse({ name: 'Shoes' });
    assert.equal(parsed.name, 'Shoes');
    assert.equal(parsed.parentId, undefined);
    assert.equal(parsed.imageUrl, undefined);
  });

  it('treats empty-string parentId/imageUrl as null (cleared form fields)', () => {
    const parsed = CreateCategorySchema.parse({
      name: 'Shoes',
      parentId: '',
      imageUrl: '',
    });
    assert.equal(parsed.parentId, null);
    assert.equal(parsed.imageUrl, null);
  });

  it('rejects non-uuid parentId and non-url imageUrl', () => {
    assert.equal(
      CreateCategorySchema.safeParse({ name: 'Shoes', parentId: 'not-a-uuid' }).success,
      false,
    );
    assert.equal(
      CreateCategorySchema.safeParse({ name: 'Shoes', imageUrl: 'not-a-url' }).success,
      false,
    );
  });

  it('coerces numeric strings and blanks for commissionRate', () => {
    assert.equal(
      CreateCategorySchema.parse({ name: 'X', commissionRate: '12.5' }).commissionRate,
      12.5,
    );
    assert.equal(
      CreateCategorySchema.parse({ name: 'X', commissionRate: '' }).commissionRate,
      undefined,
    );
    assert.equal(
      CreateCategorySchema.safeParse({ name: 'X', commissionRate: 101 }).success,
      false,
    );
  });

  it('bounds returnWindowDays and seo field lengths', () => {
    assert.equal(
      CreateCategorySchema.safeParse({ name: 'X', returnWindowDays: 400 }).success,
      false,
    );
    assert.equal(
      CreateCategorySchema.safeParse({ name: 'X', seoTitle: 'a'.repeat(256) }).success,
      false,
    );
    assert.equal(
      UpdateCategorySchema.safeParse({ seoTitle: 'a'.repeat(255) }).success,
      true,
    );
  });

  it('reorder requires a non-empty list of uuids', () => {
    assert.equal(ReorderCategoriesSchema.safeParse({ orderedIds: [] }).success, false);
    assert.equal(ReorderCategoriesSchema.safeParse({ orderedIds: [UUID] }).success, true);
    assert.equal(ReorderCategoriesSchema.safeParse({ orderedIds: ['nope'] }).success, false);
  });

  it('attribute options default to an empty list and accept mixed primitives', () => {
    const parsed = CreateCategoryAttributeSchema.parse({ name: 'Material', type: 'ENUM' });
    assert.deepEqual(parsed.options, []);
    assert.equal(
      CreateCategoryAttributeSchema.safeParse({ name: 'Size', type: 'NOPE' }).success,
      false,
    );
  });
});
