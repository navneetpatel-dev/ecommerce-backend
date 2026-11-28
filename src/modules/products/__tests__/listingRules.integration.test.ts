import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { sequelize, Category } from '@database/models';
import { SKIP_ON_DEV_DB, rows, startCatalogWorld, unique, type CatalogWorld } from '../../../testHelpers/catalogFixtures';

let world: CatalogWorld;

describe('what a listing must keep, and what a deletion frees', { skip: SKIP_ON_DEV_DB }, () => {
  before(async () => {
    world = await startCatalogWorld();
  });
  after(async () => {
    await world.close();
  });

  const addVariant = (productId: string, sku: string) =>
    world.call('POST', `/products/${productId}/variants`, world.a.owner, { sku, price: 100, stock: 1 });

  it('a live listing keeps its last variant and image; a draft may lose them (M6)', async () => {
    const live = await world.liveProduct(world.a);
    assert.equal((await world.call('DELETE', `/products/variants/${live.variantId}`, world.a.owner)).status, 422);
    assert.equal((await world.call('DELETE', `/products/images/${live.imageId}`, world.a.owner)).status, 422);
    await addVariant(live.id, `SECOND-${unique()}`);
    assert.equal((await world.call('DELETE', `/products/variants/${live.variantId}`, world.a.owner)).status, 204);

    const draft = await world.draftProduct(world.a);
    assert.equal((await world.call('DELETE', `/products/variants/${draft.variantId}`, world.a.owner)).status, 204);
    assert.equal((await world.call('DELETE', `/products/images/${draft.imageId}`, world.a.owner)).status, 204);
  });

  it('a removed SKU and a deleted product name can be used again (M7)', async () => {
    const name = `Reuse ${unique()}`;
    const product = await world.draftProduct(world.a, { name });
    const sku = `REUSE-${unique()}`;
    const added = await addVariant(product.id, sku);
    await world.call('DELETE', `/products/variants/${added.data.id}`, world.a.owner);
    assert.equal((await addVariant(product.id, sku)).status, 201);

    await world.call('DELETE', `/products/${product.id}`, world.a.owner);
    const again = await world.draftProduct(world.a, { name });
    assert.ok(again.id);
    // The deleted product's variant still holds its SKU: said plainly, not a server error.
    const held = await addVariant(again.id, sku);
    assert.equal(held.status, 422, held.text);
    assert.match(held.error.message, /deleted product/);
  });

  it('two creates racing for one name answer 409, never 500 (E8)', async () => {
    const parent = await world.category();
    const name = `Race ${unique()}`;
    const replies = await Promise.all([1, 2, 3, 4].map(() => world.call('POST', '/categories', world.admin, { name, parentId: parent.id })));
    assert.equal(replies.filter((reply) => reply.status === 201).length, 1);
    assert.ok(replies.every((reply) => [201, 409, 422].includes(reply.status)), replies.map((reply) => reply.status).join());
    assert.ok(sequelize && Category);
  });

  it('platform stock edits and deletions are audited for the vendor (L4, E9)', async () => {
    const product = await world.liveProduct(world.a);
    const extra = await addVariant(product.id, `AUD-${unique()}`);
    await world.call('PATCH', `/inventory/variants/${product.variantId}/stock`, world.catalog, { stock: 4, expectedStock: 10 });
    await world.call('DELETE', `/products/variants/${extra.data.id}`, world.admin);
    await world.call('DELETE', `/products/${product.id}`, world.admin);
    const actions = (
      await rows<{ action: string }>('SELECT action FROM audit_logs WHERE "entityId" = :id AND metadata->>\'vendorId\' = :vendor', {
        id: product.id, vendor: world.a.id,
      })
    ).map((row) => row.action);
    for (const action of ['PRODUCT_STOCK_UPDATED_ON_BEHALF', 'PRODUCT_VARIANT_DELETED_ON_BEHALF', 'PRODUCT_DELETED_ON_BEHALF']) {
      assert.ok(actions.includes(action), `${action} in ${actions}`);
    }
  });

  it("the vendor's own stock edits are not recorded as platform changes", async () => {
    const product = await world.liveProduct(world.a);
    await world.call('PATCH', `/inventory/variants/${product.variantId}/stock`, world.a.owner, { stock: 4, expectedStock: 10 });
    const found = await rows('SELECT 1 FROM audit_logs WHERE "entityId" = :id AND action = \'PRODUCT_STOCK_UPDATED_ON_BEHALF\'', { id: product.id });
    assert.equal(found.length, 0);
  });
});
