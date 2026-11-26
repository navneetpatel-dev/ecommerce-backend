import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPickerList } from '../categoryPicker';

const cat = (id: string, name: string, parentId: string | null, over: Record<string, unknown> = {}) => ({
  id, name, parentId, imageUrl: null, displayOrder: 0, status: 'ACTIVE', ...over,
}) as never;
const rates = new Map([
  ['home', { gstPercentage: 12, priceBandThreshold: null, gstPercentageAbove: null }],
  ['shoes', { gstPercentage: 5, priceBandThreshold: 1000, gstPercentageAbove: 12 }],
]);

const tree = [
  cat('home', 'Home & Kitchen', null, { displayOrder: 1 }),
  cat('cook', 'Cookware', 'home'),
  cat('pans', 'Frying Pans', 'cook'),
  cat('stor', 'Storage', 'home'),
  cat('apparel', 'Apparel', null, { displayOrder: 2 }),
  cat('tops', 'Tops', 'apparel'),
  cat('shoes', 'Footwear', null, { displayOrder: 3 }),
];

describe('buildPickerList', () => {
  it('walks the tree depth first: parents before children, siblings by order then name, with depth', () => {
    const list = buildPickerList(tree, rates, {});
    assert.deepEqual(list.map((row) => [row.name, row.depth]), [
      ['Home & Kitchen', 0], ['Cookware', 1], ['Frying Pans', 2], ['Storage', 1],
      ['Apparel', 0], ['Tops', 1], ['Footwear', 0],
    ]);
    assert.ok(list.every((row) => row.path === null));
  });

  it('each item carries its GST (default 18% when the rates have none)', () => {
    const list = buildPickerList(tree, rates, {});
    assert.equal(list.find((row) => row.id === 'home')!.gstPercentage, 12);
    assert.equal(list.find((row) => row.id === 'apparel')!.gstPercentage, 18);
    const shoes = list.find((row) => row.id === 'shoes')!;
    assert.deepEqual([shoes.gstPercentage, shoes.priceBandThreshold, shoes.gstPercentageAbove], [5, 1000, 12]);
  });

  it('archived categories are left out; one whose parent is archived is not lost', () => {
    const list = buildPickerList([cat('a', 'Old', null, { status: 'ARCHIVED' }), cat('b', 'Child of old', 'a'), cat('c', 'Fine', null)], rates, {});
    assert.deepEqual(list.map((row) => row.name), ['Child of old', 'Fine']);
    assert.equal(list[0]!.depth, 0);
  });

  it('a search lists matches flat with where they sit, case-insensitively', () => {
    const list = buildPickerList(tree, rates, { search: 'PAN' });
    assert.deepEqual(list.map((row) => [row.name, row.depth, row.path]), [['Frying Pans', 0, 'Home & Kitchen › Cookware']]);
    assert.deepEqual(buildPickerList(tree, rates, { search: 'zzz' }), []);
  });

  it('looks one category up by id (the closed field needs its name), only if it is active', () => {
    assert.deepEqual(buildPickerList(tree, rates, { id: 'tops' }).map((row) => [row.name, row.path]), [['Tops', 'Apparel']]);
    assert.deepEqual(buildPickerList([cat('x', 'Gone', null, { status: 'ARCHIVED' })], rates, { id: 'x' }), []);
  });

  it('a parent cycle cannot hang it', () => {
    const list = buildPickerList([cat('a', 'A', 'b'), cat('b', 'B', 'a')], rates, {});
    assert.ok(list.length <= 2);
  });

  it('is stable: the same input gives the same order, so pages never repeat', () => {
    const twins = [cat('b', 'Same', null), cat('a', 'Same', null)];
    assert.deepEqual(buildPickerList(twins, rates, {}).map((row) => row.id), buildPickerList([...twins].reverse(), rates, {}).map((row) => row.id));
  });
});
