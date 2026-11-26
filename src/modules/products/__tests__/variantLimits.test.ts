import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ADMIN_NOTE_LIMITS, PRODUCT_FIELD_LIMITS, VARIANT_LIMITS } from '@core/constants/product';
import {
  AddVariantSchema,
  CreateProductSchema,
  SubmitOnBehalfSchema,
  UpdateProductSchema,
  UpdateVariantSchema,
} from '../products.dto';

const ok = { sku: 'S-1', price: 10 };
const bad = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) => assert.equal(schema.safeParse(value).success, false, JSON.stringify(value).slice(0, 80));
const good = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) => assert.equal(schema.safeParse(value).success, true, JSON.stringify(value).slice(0, 80));

describe('variant field limits', () => {
  it('SKU: trimmed, 1 to 64 characters, letters digits . _ / - only', () => {
    good(AddVariantSchema, { ...ok, sku: 'A'.repeat(VARIANT_LIMITS.SKU_MAX) });
    assert.equal(AddVariantSchema.parse({ ...ok, sku: '  S1 ' }).sku, 'S1');
    for (const sku of ['', '   ', 'A'.repeat(VARIANT_LIMITS.SKU_MAX + 1), 'has space', '-lead', 'bad#', "x'; DROP"]) bad(AddVariantSchema, { ...ok, sku });
  });

  it('price, stock, low-stock level and weight have upper bounds (add and update)', () => {
    good(AddVariantSchema, { ...ok, price: PRODUCT_FIELD_LIMITS.PRICE_MAX, stock: VARIANT_LIMITS.STOCK_MAX });
    bad(AddVariantSchema, { ...ok, price: PRODUCT_FIELD_LIMITS.PRICE_MAX + 1 });
    bad(AddVariantSchema, { ...ok, stock: VARIANT_LIMITS.STOCK_MAX + 1 });
    bad(AddVariantSchema, { ...ok, lowStockAt: VARIANT_LIMITS.LOW_STOCK_MAX + 1 });
    bad(AddVariantSchema, { ...ok, weightGrams: VARIANT_LIMITS.WEIGHT_GRAMS_MAX + 1 });
    bad(UpdateVariantSchema, { price: PRODUCT_FIELD_LIMITS.PRICE_MAX + 1 });
    bad(UpdateVariantSchema, { stock: VARIANT_LIMITS.STOCK_MAX + 1 });
    bad(AddVariantSchema, { ...ok, price: 0 });
    bad(AddVariantSchema, { ...ok, stock: 1.5 });
  });

  it('options: at most 10, names up to 40 and values up to 80 characters, none empty', () => {
    good(AddVariantSchema, { ...ok, attributes: { ['n'.repeat(40)]: 'v'.repeat(80) } });
    bad(AddVariantSchema, { ...ok, attributes: { ['n'.repeat(41)]: 'v' } });
    bad(AddVariantSchema, { ...ok, attributes: { n: 'v'.repeat(81) } });
    bad(AddVariantSchema, { ...ok, attributes: { n: '' } });
    bad(UpdateVariantSchema, { attributes: { '': 'v' } });
    const eleven = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`n${i}`, 'v']));
    bad(AddVariantSchema, { ...ok, attributes: eleven });
    good(AddVariantSchema, { ...ok, attributes: Object.fromEntries(Object.entries(eleven).slice(0, 10)) });
  });
});

describe('notes and product prices', () => {
  const product = { categoryId: '11111111-1111-4111-8111-111111111111', name: 'Lamp', description: 'd', basePrice: 10 };

  it('consent note and change reason: 10 to 500 characters after trimming', () => {
    good(SubmitOnBehalfSchema, { consentNote: 'x'.repeat(ADMIN_NOTE_LIMITS.MAX) });
    for (const consentNote of ['short', '   short   ', 'x'.repeat(ADMIN_NOTE_LIMITS.MAX + 1), undefined]) bad(SubmitOnBehalfSchema, { consentNote });
    good(UpdateProductSchema, { changeReason: 'x'.repeat(ADMIN_NOTE_LIMITS.MIN) });
    bad(UpdateProductSchema, { changeReason: 'short' });
    bad(UpdateVariantSchema, { changeReason: 'x'.repeat(ADMIN_NOTE_LIMITS.MAX + 1) });
  });

  it('product price and MRP cannot exceed the maximum', () => {
    good(CreateProductSchema, { ...product, basePrice: PRODUCT_FIELD_LIMITS.PRICE_MAX });
    bad(CreateProductSchema, { ...product, basePrice: PRODUCT_FIELD_LIMITS.PRICE_MAX + 1 });
    bad(CreateProductSchema, { ...product, compareAtPrice: PRODUCT_FIELD_LIMITS.PRICE_MAX + 1 });
    bad(UpdateProductSchema, { basePrice: PRODUCT_FIELD_LIMITS.PRICE_MAX + 1 });
    bad(UpdateProductSchema, { compareAtPrice: PRODUCT_FIELD_LIMITS.PRICE_MAX + 1 });
  });
});
