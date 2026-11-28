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

  it('the Super Admin needs a reason only when live products are charged differently', async () => {
    const empty = await world.category({ commissionRate: 8 });
    assert.equal((await world.call('PATCH', `/categories/${empty.id}`, world.admin, { commissionRate: 9 })).status, 200);

    const used = await world.category({ commissionRate: 8 });
    await world.liveProduct(world.a, { categoryId: used.id });
    const query = `/categories/rate-impact?kind=edit&categoryId=${used.id}&commissionRate=25`;
    const impact = await world.call('GET', query, world.admin);
    assert.equal(impact.data.productCount, 1, impact.text);
    assert.equal(impact.data.commissionChanged, 1);
    assert.equal(impact.data.canApply, true);

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
