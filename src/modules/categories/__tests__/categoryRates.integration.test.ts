import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { SKIP_ON_DEV_DB, rows, startCatalogWorld, type CatalogWorld } from '../../../testHelpers/catalogFixtures';

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
  const categoryOf = async (id: string) =>
    (await rows<{ categoryId: string }>('SELECT "categoryId" FROM products WHERE id = :id', { id }))[0]!.categoryId;

  it('vendor staff cannot move a product to another category; the owner can', async () => {
    const product = await world.liveProduct(world.a);
    const target = await world.category();
    const staff = await world.call('PATCH', `/products/${product.id}`, world.a.staff, { categoryId: target.id });
    assert.equal(staff.status, 403, staff.text);
    // Re-sending the same category is not a change.
    assert.equal((await world.call('PATCH', `/products/${product.id}`, world.a.staff, { categoryId: product.categoryId, description: 'new' })).status, 200);
    assert.equal((await world.call('PATCH', `/products/${product.id}`, world.a.owner, { categoryId: target.id })).status, 200);
  });

  it('the Catalog Manager cannot recategorise a live vendor product; Super Admin needs a reason', async () => {
    const product = await world.liveProduct(world.a);
    const categoryId = (await world.category()).id;
    assert.equal((await world.call('PATCH', `/products/${product.id}`, world.catalog, { categoryId })).status, 403);
    assert.equal((await world.call('PATCH', `/products/${product.id}`, world.admin, { categoryId })).status, 422);
    assert.equal((await world.call('PATCH', `/products/${product.id}`, world.admin, { categoryId, changeReason: reason })).status, 200);
  });

  it('bulk reassign that changes rates needs the pricing power and a reason', async () => {
    const from = await withCommission(5);
    const to = await withCommission(25);
    const product = await world.liveProduct(world.a, { categoryId: from.id });
    const body = { fromCategoryId: from.id, toCategoryId: to.id };

    const impact = await world.call('GET', `/categories/rate-impact?kind=reassign&fromCategoryId=${from.id}&toCategoryId=${to.id}`, world.catalog);
    assert.equal(impact.data.productCount, 1, impact.text);
    assert.equal(impact.data.canApply, false);

    assert.equal((await world.call('POST', '/categories/reassign-products', world.catalog, { ...body, changeReason: reason })).status, 403);
    assert.equal((await world.call('POST', '/categories/reassign-products', world.admin, body)).status, 422);
    assert.equal(await categoryOf(product.id), from.id);
    assert.equal((await world.call('POST', '/categories/reassign-products', world.admin, { ...body, changeReason: reason })).status, 200);
    assert.equal(await categoryOf(product.id), to.id);
    const audit = await rows('SELECT metadata FROM audit_logs WHERE action = \'CATEGORY_RATE_CHANGED\' AND "entityId" = :id', { id: to.id });
    assert.equal(audit.length, 1);
  });

  it('bulk reassign with unchanged rates stays open to the Catalog Manager', async () => {
    const from = await withCommission(9);
    const to = await withCommission(9);
    await world.liveProduct(world.a, { categoryId: from.id });
    const reply = await world.call('POST', '/categories/reassign-products', world.catalog, { fromCategoryId: from.id, toCategoryId: to.id });
    assert.equal(reply.status, 200, reply.text);
  });

  it('re-parenting that changes rates is gated, by both routes', async () => {
    const parent = await withCommission(30);
    const child = await world.category();
    await world.liveProduct(world.a, { categoryId: child.id });
    assert.equal((await world.call('PATCH', `/categories/${child.id}/move`, world.catalog, { parentId: parent.id })).status, 403);
    assert.equal((await world.call('PATCH', `/categories/${child.id}`, world.catalog, { parentId: parent.id })).status, 403);
    assert.equal((await world.call('PATCH', `/categories/${child.id}`, world.admin, { parentId: parent.id, changeReason: reason })).status, 200);
  });
});
