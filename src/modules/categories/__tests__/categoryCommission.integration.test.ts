import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { SKIP_ON_DEV_DB, rows, startCatalogWorld, unique, type CatalogWorld } from '../../../testHelpers/catalogFixtures';

let world: CatalogWorld;
const reason = 'New commission agreed with the sellers';

describe("a category's commission rate is the platform's pricing", { skip: SKIP_ON_DEV_DB }, () => {
  before(async () => {
    world = await startCatalogWorld();
  });
  after(async () => {
    await world.close();
  });

  const rateOf = async (id: string) =>
    (await rows<{ rate: string | null }>('SELECT "commissionRate" AS rate FROM categories WHERE id = :id', { id }))[0]!.rate;

  it('the Catalog Manager creates categories, but not with a commission rate', async () => {
    const refused = await world.call('POST', '/categories', world.catalog, { name: `Rate ${unique()}`, commissionRate: 5 });
    assert.equal(refused.status, 403, refused.text);
    const plain = await world.call('POST', '/categories', world.catalog, { name: `Plain ${unique()}` });
    assert.equal(plain.status, 201, plain.text);
    const priced = await world.call('POST', '/categories', world.admin, { name: `Priced ${unique()}`, commissionRate: 5 });
    assert.equal(priced.status, 201, priced.text);
  });

  it('the Catalog Manager cannot change or clear it, even on an empty category', async () => {
    const category = await world.category({ commissionRate: 8 });
    for (const commissionRate of [20, 0, null]) {
      const reply = await world.call('PATCH', `/categories/${category.id}`, world.catalog, { commissionRate, changeReason: reason });
      assert.equal(reply.status, 403, `${commissionRate}: ${reply.text}`);
    }
    assert.equal(Number(await rateOf(category.id)), 8);
  });

  it('the Catalog Manager still edits the rest, re-sending the stored rate, and the COD setting', async () => {
    const category = await world.category({ commissionRate: 8 });
    const reply = await world.call('PATCH', `/categories/${category.id}`, world.catalog, {
      name: `Renamed ${unique()}`,
      commissionRate: 8,
      codEnabled: false,
    });
    assert.equal(reply.status, 200, reply.text);
  });

  it('the Super Admin needs a reason only when live products are charged differently', async () => {
    const empty = await world.category({ commissionRate: 8 });
    assert.equal((await world.call('PATCH', `/categories/${empty.id}`, world.admin, { commissionRate: 9 })).status, 200);

    const used = await world.category({ commissionRate: 8 });
    await world.liveProduct(world.a, { categoryId: used.id });
    const query = `/categories/rate-impact?kind=edit&categoryId=${used.id}&commissionRate=25`;
    const forCatalog = await world.call('GET', query, world.catalog);
    assert.equal(forCatalog.data.productCount, 1, forCatalog.text);
    assert.equal(forCatalog.data.commissionChanged, 1);
    assert.equal(forCatalog.data.canApply, false);
    assert.equal((await world.call('GET', query, world.admin)).data.canApply, true);

    assert.equal((await world.call('PATCH', `/categories/${used.id}`, world.admin, { commissionRate: 25 })).status, 422);
    assert.equal(Number(await rateOf(used.id)), 8);
    const applied = await world.call('PATCH', `/categories/${used.id}`, world.admin, { commissionRate: 25, changeReason: reason });
    assert.equal(applied.status, 200, applied.text);
    assert.equal(Number(await rateOf(used.id)), 25);
    const [audit] = await rows<{ metadata: { vendorId: string; reason: string } }>(
      `SELECT metadata FROM audit_logs WHERE action = 'CATEGORY_RATE_CHANGED' AND "entityId" = :id`,
      { id: used.id },
    );
    assert.equal(audit?.metadata.vendorId, world.a.id);
    assert.equal(audit?.metadata.reason, reason);
  });
});
