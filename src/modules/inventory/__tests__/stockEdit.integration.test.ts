import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { SKIP_ON_DEV_DB, rows, startCatalogWorld, type CatalogWorld } from '../../../testHelpers/catalogFixtures';

let world: CatalogWorld;

describe('saving stock never undoes sales made while the editor was open', { skip: SKIP_ON_DEV_DB }, () => {
  before(async () => {
    world = await startCatalogWorld();
  });
  after(async () => {
    await world.close();
  });

  const stockOf = async (id: string) =>
    (await rows<{ stock: number }>('SELECT stock FROM product_variants WHERE id = :id', { id }))[0]!.stock;
  /** The editor opened at 10; an order then took 3. */
  async function soldWhileOpen() {
    const product = await world.liveProduct(world.a, { stock: 10 });
    await rows('UPDATE product_variants SET stock = 7 WHERE id = :id RETURNING id', { id: product.variantId });
    return product;
  }

  it('variant save: a price-only change leaves the stock alone', async () => {
    const product = await soldWhileOpen();
    const reply = await world.call('PATCH', `/products/variants/${product.variantId}`, world.a.owner, { price: 101 });
    assert.equal(reply.status, 200, reply.text);
    assert.equal(await stockOf(product.variantId), 7);
  });

  it('variant save: a restock of 5 is added to what is left', async () => {
    const product = await soldWhileOpen();
    const reply = await world.call('PATCH', `/products/variants/${product.variantId}`, world.a.owner, { stock: 15, expectedStock: 10 });
    assert.equal(reply.status, 200, reply.text);
    assert.equal(reply.data.stock, 12);
    assert.equal(await stockOf(product.variantId), 12);
  });

  it('a stock change without the figure the editor showed is refused, on both routes', async () => {
    const product = await soldWhileOpen();
    assert.equal((await world.call('PATCH', `/products/variants/${product.variantId}`, world.a.owner, { stock: 10 })).status, 422);
    assert.equal((await world.call('PATCH', `/inventory/variants/${product.variantId}/stock`, world.a.owner, { stock: 10 })).status, 422);
    assert.equal(await stockOf(product.variantId), 7);
  });

  it('inventory editor: the change is applied to the current stock', async () => {
    const product = await soldWhileOpen();
    const reply = await world.call('PATCH', `/inventory/variants/${product.variantId}/stock`, world.a.owner, { stock: 8, expectedStock: 10 });
    assert.equal(reply.data.stock, 5, reply.text);
  });
});
