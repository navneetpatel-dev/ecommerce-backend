import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { SKIP_ON_DEV_DB, startCatalogWorld, type CatalogWorld } from '../../../testHelpers/catalogFixtures';

let world: CatalogWorld;
const reason = 'Moved to the correct category for tax purposes';

describe('a category change is a pricing change', { skip: SKIP_ON_DEV_DB }, () => {
  before(async () => {
    world = await startCatalogWorld();
  });
  after(async () => {
    await world.close();
  });

  /** A category charging its own commission, so a move changes what the vendor pays. */
  const withCommission = (rate: number) => world.category({ commissionRate: rate });

  it('the vendor can move their own product to another category', async () => {
    const product = await world.liveProduct(world.a);
    const target = await world.category();
    assert.equal((await world.call('PATCH', `/products/${product.id}`, world.a.owner, { categoryId: target.id })).status, 200);
  });

  it('the Super Admin needs a reason to recategorise a live vendor product', async () => {
    const product = await world.liveProduct(world.a);
    const categoryId = (await world.category()).id;
    assert.equal((await world.call('PATCH', `/products/${product.id}`, world.admin, { categoryId })).status, 422);
    assert.equal((await world.call('PATCH', `/products/${product.id}`, world.admin, { categoryId, changeReason: reason })).status, 200);
  });

  it('offers no bulk move of one category\'s products to another', async () => {
    const from = await world.category();
    const to = await world.category();
    const body = { fromCategoryId: from.id, toCategoryId: to.id };
    assert.equal((await world.call('POST', '/categories/reassign-products', world.admin, body)).status, 404);
    const preview = `/categories/rate-impact?kind=reassign&fromCategoryId=${from.id}&toCategoryId=${to.id}`;
    assert.equal((await world.call('GET', preview, world.admin)).status, 422);
  });

  it('re-parenting that changes rates needs a reason', async () => {
    const parent = await withCommission(30);
    const child = await world.category();
    await world.liveProduct(world.a, { categoryId: child.id });
    assert.equal((await world.call('PATCH', `/categories/${child.id}/move`, world.admin, { parentId: parent.id })).status, 422);
    assert.equal((await world.call('PATCH', `/categories/${child.id}`, world.admin, { parentId: parent.id })).status, 422);
    assert.equal((await world.call('PATCH', `/categories/${child.id}`, world.admin, { parentId: parent.id, changeReason: reason })).status, 200);
  });
});
