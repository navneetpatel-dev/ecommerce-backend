import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveCategoryRules } from '../taxRuleResolution';

const rule = (id: string, categoryId: string | null, gst: number, over: Record<string, unknown> = {}) =>
  ({ id, categoryId, gstPercentage: gst, hsnCode: null, priceBandThreshold: null, gstPercentageAbove: null, ...over }) as never;
const tree = [
  { id: 'apparel', parentId: null },
  { id: 'tops', parentId: 'apparel' },
  { id: 'tshirts', parentId: 'tops' },
  { id: 'toys', parentId: null },
];
const by = (list: ReturnType<typeof resolveCategoryRules>, id: string) => list.find((row) => row.categoryId === id)!;

describe('resolveCategoryRules: which rule a category gets, and why', () => {
  const rules = [rule('r-apparel', 'apparel', 12), rule('r-default', null, 18)];

  it('own, inherited (with the ancestor it came from), default and fallback', () => {
    const list = resolveCategoryRules(rules, tree);
    assert.deepEqual([by(list, 'apparel').source, by(list, 'apparel').ruleId], ['own', 'r-apparel']);
    assert.deepEqual([by(list, 'tshirts').source, by(list, 'tshirts').fromCategoryId, by(list, 'tshirts').gstPercentage], ['inherited', 'apparel', 12]);
    assert.deepEqual([by(list, 'toys').source, by(list, 'toys').ruleId], ['default', 'r-default']);
    const none = resolveCategoryRules([], tree);
    assert.deepEqual([by(none, 'toys').source, by(none, 'toys').gstPercentage, by(none, 'toys').ruleId], ['fallback', 18, null]);
  });

  it('a nearer rule beats a farther one', () => {
    const list = resolveCategoryRules([rule('a', 'apparel', 12), rule('t', 'tops', 5)], tree);
    assert.equal(by(list, 'tshirts').ruleId, 't');
    assert.equal(by(list, 'tops').source, 'own');
  });

  it('the first rule in picking order wins when a category has two', () => {
    const list = resolveCategoryRules([rule('old', 'apparel', 12), rule('new', 'apparel', 28)], tree);
    assert.equal(by(list, 'apparel').ruleId, 'old');
  });

  it('carries the price band only when complete, and the HSN code', () => {
    const list = resolveCategoryRules(
      [rule('s', 'apparel', 5, { priceBandThreshold: '1000', gstPercentageAbove: '12', hsnCode: '6109' }), rule('b', 'toys', 5, { priceBandThreshold: '1000' })],
      tree,
    );
    assert.deepEqual([by(list, 'apparel').priceBandThreshold, by(list, 'apparel').gstPercentageAbove, by(list, 'apparel').hsnCode], [1000, 12, '6109']);
    assert.equal(by(list, 'toys').priceBandThreshold, null);
  });

  it('counts per rule add up (how many categories each rule decides)', () => {
    const list = resolveCategoryRules(rules, tree);
    const count = (id: string) => list.filter((row) => row.ruleId === id).length;
    assert.deepEqual([count('r-apparel'), count('r-default')], [3, 1]);
  });

  it('a parent cycle cannot hang it', () => {
    const list = resolveCategoryRules([], [{ id: 'x', parentId: 'y' }, { id: 'y', parentId: 'x' }]);
    assert.equal(list.length, 2);
  });
});
