import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CreateProductSchema, UpdateProductSchema } from '../products.dto';
import { ERROR_MESSAGES } from '@core/constants/errors';

const baseCreate = {
  categoryId: '11111111-1111-4111-8111-111111111111',
  name: 'Steel pan',
  description: 'A durable frying pan for daily cooking.',
  basePrice: 1299,
};

describe('CreateProductSchema', () => {
  it('accepts a valid listing with optional catalog fields', () => {
    const parsed = CreateProductSchema.parse({
      ...baseCreate,
      brand: 'HomeCraft',
      compareAtPrice: 1599,
      tags: ['cookware'],
      highlights: ['Induction safe'],
      specs: { Material: 'Steel' },
      deliveryNote: 'Ships in 2 days',
      returnNote: 'Replacement only if damaged',
    });
    assert.equal(parsed.brand, 'HomeCraft');
    assert.equal(parsed.compareAtPrice, 1599);
    assert.deepEqual(parsed.highlights, ['Induction safe']);
    assert.equal(parsed.specs.Material, 'Steel');
  });

  it('rejects MRP below selling price', () => {
    const result = CreateProductSchema.safeParse({
      ...baseCreate,
      compareAtPrice: 100,
    });
    assert.equal(result.success, false);
    if (!result.success) {
      const compareError = result.error.flatten().fieldErrors.compareAtPrice?.[0];
      assert.equal(compareError, ERROR_MESSAGES.PRODUCT_COMPARE_AT_BELOW_PRICE);
    }
  });

  it('treats blank brand and notes as null', () => {
    const parsed = CreateProductSchema.parse({
      ...baseCreate,
      brand: '  ',
      deliveryNote: '',
      returnNote: '   ',
    });
    assert.equal(parsed.brand, null);
    assert.equal(parsed.deliveryNote, null);
    assert.equal(parsed.returnNote, null);
  });

  it('rejects more highlights than allowed', () => {
    const result = CreateProductSchema.safeParse({
      ...baseCreate,
      highlights: Array.from({ length: 13 }, (_, index) => `Highlight ${index + 1}`),
    });
    assert.equal(result.success, false);
  });

  it('rejects duplicate specification labels', () => {
    const result = CreateProductSchema.safeParse({
      ...baseCreate,
      specs: { Material: 'Steel', material: 'Aluminium' },
    });
    assert.equal(result.success, false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      assert.ok(messages.includes(ERROR_MESSAGES.PRODUCT_SPEC_DUPLICATE_KEY));
    }
  });
});

describe('UpdateProductSchema', () => {
  it('allows clearing MRP', () => {
    const parsed = UpdateProductSchema.parse({ compareAtPrice: null });
    assert.equal(parsed.compareAtPrice, null);
  });
});
