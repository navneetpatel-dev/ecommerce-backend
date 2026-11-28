import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { SKIP_ON_DEV_DB, startCatalogWorld, unique, type CatalogWorld } from '../../../testHelpers/catalogFixtures';

let world: CatalogWorld;

describe('the low-stock list', { skip: SKIP_ON_DEV_DB }, () => {
  before(async () => {
    world = await startCatalogWorld();
  });
  after(async () => {
    await world.close();
  });

  async function productAt(stock: number, lowStockAt: number, name = `Low ${unique()}`) {
    const product = await world.liveProduct(world.a, { name, stock });
    await world.call('PATCH', `/products/variants/${product.variantId}`, world.a.owner, { lowStockAt });
    return product;
  }
  const ids = (reply: { data: any }) => reply.data.map((row: any) => row.id);

  it("uses each variant's own alert level, not a fixed 10 (M1)", async () => {
    const high = await productAt(30, 50);
    const fine = await productAt(8, 2);
    const listed = ids(await world.call('GET', '/inventory/low-stock?limit=100', world.a.owner));
    assert.ok(listed.includes(high.variantId));
    assert.ok(!listed.includes(fine.variantId));
    assert.ok(ids(await world.call('GET', '/inventory/low-stock?threshold=10&limit=100', world.a.owner)).includes(fine.variantId));
  });

  it('leaves out deleted and archived products (M2)', async () => {
    const deleted = await productAt(1, 5);
    const archived = await productAt(1, 5);
    await world.call('DELETE', `/products/${deleted.id}`, world.a.owner);
    await world.call('POST', `/products/${archived.id}/archive`, world.admin);
    const reply = await world.call('GET', `/inventory/low-stock?limit=100&vendorId=${world.a.id}`, world.admin);
    assert.ok(!ids(reply).includes(deleted.variantId));
    assert.ok(!ids(reply).includes(archived.variantId));
    assert.ok(reply.data.every((row: any) => row.product));
  });

  it('is paged, searched and filtered by the server (M2)', async () => {
    const name = `Searchable ${unique()}`;
    const empty = await productAt(0, 5, name);
    await productAt(2, 5);
    const page = await world.call('GET', '/inventory/low-stock?limit=1', world.a.owner);
    assert.equal(page.data.length, 1);
    assert.ok(JSON.parse(page.text).meta?.pagination.total >= 2 || JSON.parse(page.text).pagination?.total >= 2, page.text.slice(0, 200));
    const found = await world.call('GET', `/inventory/low-stock?search=${encodeURIComponent(name)}`, world.a.owner);
    assert.deepEqual(ids(found), [empty.variantId]);
    const out = await world.call('GET', '/inventory/low-stock?level=OUT_OF_STOCK&sort=name_asc', world.a.owner);
    assert.ok(out.data.every((row: any) => row.stock === 0), out.text.slice(0, 200));
    assert.equal((await world.call('GET', '/inventory/low-stock?sort=stock_desc', world.a.owner)).status, 200);
  });

  it('answers bad input with 422, not a server error (L6)', async () => {
    for (const query of ['threshold=abc', 'threshold=-1', 'limit=100000', 'level=NONE']) {
      assert.equal((await world.call('GET', `/inventory/low-stock?${query}`, world.a.owner)).status, 422, query);
    }
  });
});
