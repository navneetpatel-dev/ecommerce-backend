import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Category } from '@database/models/category.model';
import { TaxRule } from '@database/models/taxRule.model';
import { taxService } from '../tax.service';

const rule = (over: Record<string, unknown>) => ({ categoryId: null, gstPercentage: '18', priceBandThreshold: null, gstPercentageAbove: null, ...over }) as never;
const category = (id: string, parentId: string | null) => ({ id, parentId }) as never;

describe('categoryGstRates', () => {
  afterEach(() => mock.restoreAll());

  function setup(rules: unknown[], categories: unknown[]) {
    mock.method(TaxRule, 'findAll', async () => rules as never);
    mock.method(Category, 'findAll', async () => categories as never);
  }
  const rateOf = async (id: string) => (await taxService.categoryGstRates()).find((row) => row.categoryId === id)!;

  it('a category uses its own rule, else the nearest ancestor’s, else the platform default', async () => {
    setup(
      [rule({ categoryId: 'apparel', gstPercentage: '12' }), rule({ categoryId: null, gstPercentage: '18' })],
      [category('apparel', null), category('tops', 'apparel'), category('tshirts', 'tops'), category('toys', null)],
    );
    assert.equal((await rateOf('apparel')).gstPercentage, 12);
    assert.equal((await rateOf('tops')).gstPercentage, 12, 'inherits from the parent');
    assert.equal((await rateOf('tshirts')).gstPercentage, 12, 'and from the grandparent');
    assert.equal((await rateOf('toys')).gstPercentage, 18, 'no rule up the tree: the default');
  });

  it('a nearer rule beats a farther one', async () => {
    setup(
      [rule({ categoryId: 'apparel', gstPercentage: '12' }), rule({ categoryId: 'tops', gstPercentage: '5' })],
      [category('apparel', null), category('tops', 'apparel'), category('tshirts', 'tops')],
    );
    assert.equal((await rateOf('tshirts')).gstPercentage, 5);
  });

  it('with no rules at all it is 18%, like the single lookup', async () => {
    setup([], [category('a', null)]);
    assert.deepEqual(await rateOf('a'), { categoryId: 'a', gstPercentage: 18, priceBandThreshold: null, gstPercentageAbove: null });
  });

  it('carries the price band only when it is complete', async () => {
    setup(
      [rule({ categoryId: 'shoes', gstPercentage: '5', priceBandThreshold: '1000', gstPercentageAbove: '12' }), rule({ categoryId: 'bags', gstPercentage: '5', priceBandThreshold: '1000' })],
      [category('shoes', null), category('bags', null)],
    );
    assert.deepEqual(await rateOf('shoes'), { categoryId: 'shoes', gstPercentage: 5, priceBandThreshold: 1000, gstPercentageAbove: 12 });
    assert.equal((await rateOf('bags')).priceBandThreshold, null);
  });

  it('the oldest rule wins when a category has two, and a parent cycle cannot hang it', async () => {
    setup(
      [rule({ categoryId: 'a', gstPercentage: '12' }), rule({ categoryId: 'a', gstPercentage: '28' })],
      [category('a', null), category('x', 'y'), category('y', 'x')],
    );
    assert.equal((await rateOf('a')).gstPercentage, 12);
    assert.equal((await rateOf('x')).gstPercentage, 18);
  });
});
