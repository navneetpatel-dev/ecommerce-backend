import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { SKIP_ON_DEV_DB, rows, startCatalogWorld, type CatalogWorld } from '../../../testHelpers/catalogFixtures';

let world: CatalogWorld;

describe('a rejected listing can be fixed and sent back', { skip: SKIP_ON_DEV_DB }, () => {
  before(async () => {
    world = await startCatalogWorld();
  });
  after(async () => {
    await world.close();
  });

  const state = async (id: string) =>
    (await rows<{ status: string; rejectionNote: string | null }>('SELECT status, "rejectionNote" FROM products WHERE id = :id', { id }))[0]!;

  for (const [who, actor] of [['owner', 'owner'], ['staff', 'staff']] as const) {
    it(`the vendor ${who} resubmits after a rejection, back to the moderation queue`, async () => {
      const product = await world.draftProduct(world.a);
      world.expectStatus(await world.call('POST', `/products/${product.id}/submit`, world.a.owner), 200, 'submit');
      world.expectStatus(await world.call('POST', `/products/${product.id}/reject`, world.admin, { rejectionNote: 'Fix the title' }), 200, 'reject');
      assert.deepEqual(await state(product.id), { status: 'REJECTED', rejectionNote: 'Fix the title' });
      await world.call('PATCH', `/products/${product.id}`, world.a[actor], { description: 'fixed' });

      const reply = await world.call('POST', `/products/${product.id}/submit`, world.a[actor]);
      assert.equal(reply.status, 200, reply.text);
      assert.deepEqual(await state(product.id), { status: 'PENDING_APPROVAL', rejectionNote: null });
    });
  }

  it('a live listing cannot be submitted again, and another vendor cannot resubmit it', async () => {
    const live = await world.liveProduct(world.a);
    assert.equal((await world.call('POST', `/products/${live.id}/submit`, world.a.owner)).status, 422);
    const draft = await world.draftProduct(world.a);
    assert.equal((await world.call('POST', `/products/${draft.id}/submit`, world.b.owner)).status, 403);
  });
});
