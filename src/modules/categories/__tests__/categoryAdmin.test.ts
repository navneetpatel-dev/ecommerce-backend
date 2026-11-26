import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAdminCategoryList } from '../categoryAdmin';

const row = (id: string, name: string, parentId: string | null, over: Record<string, unknown> = {}) =>
  ({ id, name, slug: name.toLowerCase(), parentId, imageUrl: null, status: 'ACTIVE', displayOrder: 0, seoTitle: null, seoDescription: null, commissionRate: null, returnWindowDays: null, codEnabled: true, defaultWarrantyMonths: null, defaultWarrantyType: null, ...over }) as never;
const tree = [
  row('home', 'Home', null, { displayOrder: 1 }),
  row('cook', 'Cookware', 'home'),
  row('pans', 'Pans', 'cook', { status: 'ARCHIVED' }),
  row('apparel', 'Apparel', null, { displayOrder: 2, commissionRate: '7.50' }),
  row('tops', 'Tops', 'apparel'),
];
const rule = (categoryId: string, over: Record<string, unknown> = {}) => [categoryId, { categoryId, ruleId: 'r', source: 'own', fromCategoryId: null, gstPercentage: 12, priceBandThreshold: null, gstPercentageAbove: null, hsnCode: null, ...over }] as const;
const rules = new Map([rule('home'), rule('cook', { source: 'inherited', fromCategoryId: 'home' })]) as never;
const counts = new Map([['cook', 4]]);

describe('buildAdminCategoryList', () => {
  it('walks the tree depth first with depth, child counts and product counts, every status included', () => {
    const list = buildAdminCategoryList(tree, rules, counts, {});
    assert.deepEqual(list.map((r) => [r.name, r.depth, r.childCount, r.productCount]), [
      ['Home', 0, 1, 0], ['Cookware', 1, 1, 4], ['Pans', 2, 0, 0], ['Apparel', 0, 1, 0], ['Tops', 1, 0, 0],
    ]);
    assert.equal(list.find((r) => r.id === 'pans')!.status, 'ARCHIVED');
  });

  it('says what GST each gets and where it comes from; 18% fallback when nothing applies', () => {
    const list = buildAdminCategoryList(tree, rules, counts, {});
    const cook = list.find((r) => r.id === 'cook')!;
    assert.deepEqual([cook.gst.percent, cook.gst.source, cook.gst.fromCategoryName], [12, 'inherited', 'Home']);
    assert.deepEqual([list.find((r) => r.id === 'tops')!.gst.percent, list.find((r) => r.id === 'tops')!.gst.source], [18, 'fallback']);
  });

  it('the commission is a number for the admin (it never goes to the public API)', () => {
    assert.equal(buildAdminCategoryList(tree, rules, counts, {}).find((r) => r.id === 'apparel')!.commissionRate, 7.5);
  });

  it('filters by status and by search (flat, with the path), and can leave one subtree out', () => {
    assert.deepEqual(buildAdminCategoryList(tree, rules, counts, { status: 'ARCHIVED' }).map((r) => r.name), ['Pans']);
    const found = buildAdminCategoryList(tree, rules, counts, { search: 'PAN' });
    assert.deepEqual(found.map((r) => [r.name, r.depth, r.path]), [['Pans', 0, 'Home › Cookware']]);
    assert.deepEqual(buildAdminCategoryList(tree, rules, counts, { excludeId: 'home' }).map((r) => r.name), ['Apparel', 'Tops']);
  });

  it('a category whose parent is missing is not lost, and a cycle cannot hang it', () => {
    assert.equal(buildAdminCategoryList([row('a', 'A', 'gone')], new Map() as never, new Map(), {}).length, 1);
    assert.ok(buildAdminCategoryList([row('x', 'X', 'y'), row('y', 'Y', 'x')], new Map() as never, new Map(), {}).length <= 2);
  });
});
