import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { SKIP_ON_DEV_DB, rows, startCatalogWorld, unique, type CatalogWorld } from '../../../testHelpers/catalogFixtures';

let world: CatalogWorld;

describe('creating and changing products over HTTP', { skip: SKIP_ON_DEV_DB }, () => {
  before(async () => {
    world = await startCatalogWorld();
  });
  after(async () => {
    await world.close();
  });

  const body = async (name: string) => ({ categoryId: (await world.category()).id, name, description: 'd', basePrice: 100 });

  it('a vendor can create a product and gets it back', async () => {
    const name = `Created ${unique()}`;
    const reply = await world.call('POST', '/products', world.a.owner, await body(name));
    assert.equal(reply.status, 201, reply.text);
    assert.equal(reply.data.name, name);
    const [row] = await rows('SELECT "vendorId", status FROM products WHERE id = :id', { id: reply.data.id });
    assert.deepEqual(row, { vendorId: world.a.id, status: 'DRAFT' });
  });

  it('an admin can list a product for a vendor', async () => {
    const reply = await world.call('POST', '/products/on-behalf', world.admin, { vendorId: world.a.id, product: await body(`Behalf ${unique()}`) });
    assert.equal(reply.status, 201, reply.text);
  });

  it('CSV bulk import creates its rows', async () => {
    const categoryId = (await world.category()).id;
    const form = new FormData();
    form.append('file', new Blob([`categoryId,name,description,basePrice\n${categoryId},Imported ${unique()},A mug,199\n`], { type: 'text/csv' }), 'p.csv');
    const res = await fetch(`${world.base}/products/bulk-import`, { method: 'POST', headers: { authorization: `Bearer ${world.a.owner.token}` }, body: form });
    const json = (await res.json()) as { data: Array<{ success: boolean; error?: string }> };
    assert.equal(res.status, 200);
    assert.deepEqual(json.data.map((row) => row.success), [true], JSON.stringify(json.data));
  });

  it('a caller without a store cannot create a product (M8)', async () => {
    for (const who of [world.catalog, world.admin]) {
      const reply = await world.call('POST', '/products', who, await body(`Vendorless ${unique()}`));
      assert.equal(reply.status, 403, reply.text);
    }
    const [count] = await rows<{ n: number }>(`SELECT COUNT(*)::int AS n FROM products WHERE name LIKE 'Vendorless %'`);
    assert.equal(count!.n, 0);
  });

  it('archive, unarchive and category rename answer with the new values (L1)', async () => {
    const product = await world.liveProduct(world.a);
    assert.equal((await world.call('POST', `/products/${product.id}/archive`, world.admin)).data.status, 'ARCHIVED');
    assert.equal((await world.call('POST', `/products/${product.id}/unarchive`, world.admin)).data.status, 'DRAFT');
    const category = await world.category();
    const name = `Renamed ${unique()}`;
    const reply = await world.call('PATCH', `/categories/${category.id}`, world.admin, { name });
    assert.equal(reply.data.name, name, reply.text);
  });

  it('changing a user answers with the new values (E2)', async () => {
    const target = await world.createActor('CUSTOMER');
    const reply = await world.call('PATCH', `/users/${target.id}/status`, world.admin, { status: 'BLOCKED' });
    assert.equal(reply.status, 200, reply.text);
    assert.equal(reply.data.status, 'BLOCKED');
  });
});
