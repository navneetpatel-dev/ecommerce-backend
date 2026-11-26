import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GST_SLABS } from '@core/constants/tax';
import { CreateTaxRuleSchema, TaxRuleListQuerySchema, UpdateTaxRuleSchema } from '../tax.dto';

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => assert.equal(schema.safeParse(v).success, true, JSON.stringify(v));
const bad = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => assert.equal(schema.safeParse(v).success, false, JSON.stringify(v));

describe('tax rule input', () => {
  it('the standard slabs are the documented ones', () => {
    assert.deepEqual([...GST_SLABS], [0, 0.25, 3, 5, 12, 18, 28]);
  });

  it('GST: 0 to 100 with at most two decimals', () => {
    for (const gstPercentage of [0, 0.25, 5, 12.5, 100]) ok(CreateTaxRuleSchema, { gstPercentage });
    for (const gstPercentage of [-1, 100.01, 12.345, '18']) bad(CreateTaxRuleSchema, { gstPercentage });
  });

  it('HSN: 4, 6 or 8 digits, or empty', () => {
    for (const hsnCode of ['6109', '610910', '61091000', '', undefined]) ok(CreateTaxRuleSchema, { gstPercentage: 5, hsnCode });
    for (const hsnCode of ['610', '61091', '6109100', '610910000', '61A9', ' 6109x']) bad(CreateTaxRuleSchema, { gstPercentage: 5, hsnCode });
  });

  it('the category is optional or null (the default); update may clear it', () => {
    ok(CreateTaxRuleSchema, { gstPercentage: 5, categoryId: '11111111-1111-4111-8111-111111111111' });
    ok(CreateTaxRuleSchema, { gstPercentage: 5, categoryId: null });
    ok(UpdateTaxRuleSchema, { categoryId: null });
    bad(UpdateTaxRuleSchema, { categoryId: 'not-a-uuid' });
  });

  it('the price band is both fields or neither, with sane values', () => {
    ok(CreateTaxRuleSchema, { gstPercentage: 5, priceBandThreshold: 1000, gstPercentageAbove: 12 });
    bad(CreateTaxRuleSchema, { gstPercentage: 5, priceBandThreshold: 1000 });
    bad(CreateTaxRuleSchema, { gstPercentage: 5, gstPercentageAbove: 12 });
    bad(CreateTaxRuleSchema, { gstPercentage: 5, priceBandThreshold: 0, gstPercentageAbove: 12 });
    bad(CreateTaxRuleSchema, { gstPercentage: 5, priceBandThreshold: 1000, gstPercentageAbove: 101 });
  });

  it('the list query: page size capped, filters validated', () => {
    ok(TaxRuleListQuerySchema, { page: '2', limit: '25', search: 'app', gstPercentage: '12', hasBand: 'YES', scope: 'category' });
    bad(TaxRuleListQuerySchema, { hasBand: 'MAYBE' });
    bad(TaxRuleListQuerySchema, { scope: 'x' });
    bad(TaxRuleListQuerySchema, { limit: '5000' });
  });
});
