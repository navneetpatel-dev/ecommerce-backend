import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { SKIP_ON_DEV_DB, rows, startCatalogWorld, unique, type CatalogWorld } from '../../../testHelpers/catalogFixtures';

let world: CatalogWorld;

type Audit = { metadata: { vendorId: string; changedFields: string[]; before?: Record<string, string>; after?: Record<string, string> } };
const audits = (id: string) =>
  rows<Audit>(`SELECT metadata FROM audit_logs WHERE action = 'PRODUCT_LIVE_EDITED_BY_VENDOR' AND "entityId" = :id ORDER BY "createdAt"`, { id });
const mails = (id: string) =>
  rows<{ userId: string }>(
    `SELECT "userId" FROM notification_logs WHERE type = 'ADMIN_VENDOR_PRODUCT_EDITED' AND "referenceId" LIKE :ref`,
    { ref: `${id}:%` },
  );
/** The email is queued after the reply has gone out. */
async function mailsOnceQueued(id: string, userId: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const found = await mails(id);
    if (found.some((mail) => mail.userId === userId)) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return mails(id);
}

describe("a vendor's edit of a live listing", { skip: SKIP_ON_DEV_DB }, () => {
  before(async () => {
    world = await startCatalogWorld();
  });
  after(async () => {
    await world.close();
  });

  it('is published at once, recorded with the old and new text, and the reviewers are told', async () => {
    const product = await world.liveProduct(world.a);
    const name = `Renamed ${unique()}`;
    const reply = await world.call('PATCH', `/products/${product.id}`, world.a.owner, { name });
    assert.equal(reply.status, 200, reply.text);
    assert.equal(reply.data.status, 'LIVE');

    const [audit] = await audits(product.id);
    assert.equal(audit?.metadata.vendorId, world.a.id);
    assert.deepEqual(audit?.metadata.changedFields, ['name']);
    assert.equal(audit?.metadata.before?.name, product.name);
    assert.equal(audit?.metadata.after?.name, name);

    const told = await mailsOnceQueued(product.id, world.admin.id);
    assert.ok(told.some((mail) => mail.userId === world.admin.id), 'Super Admin');
    assert.ok(!told.some((mail) => [world.a.owner.id, world.customer.id].includes(mail.userId)));
  });

  it('covers images, and emails once a day per product', async () => {
    const product = await world.liveProduct(world.a);
    const added = await world.call('POST', `/products/${product.id}/images`, world.a.owner, { url: 'https://example.invalid/b.jpg' });
    assert.equal(added.status, 201, added.text);
    await mailsOnceQueued(product.id, world.admin.id);
    assert.equal((await world.call('PATCH', `/products/images/${added.data.id}/primary`, world.a.owner)).status, 200);
    assert.equal((await world.call('DELETE', `/products/images/${product.imageId}`, world.a.owner)).status, 204);

    assert.deepEqual((await audits(product.id)).map((row) => row.metadata.changedFields), [['images'], ['primary image'], ['images']]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal((await mails(product.id)).filter((mail) => mail.userId === world.admin.id).length, 1);
  });

  it('says nothing about drafts, other fields, unchanged text or platform edits', async () => {
    const draft = await world.draftProduct(world.a);
    await world.call('PATCH', `/products/${draft.id}`, world.a.owner, { name: `Draft ${unique()}` });
    const live = await world.liveProduct(world.a);
    assert.equal((await world.call('PATCH', `/products/${live.id}`, world.a.owner, { basePrice: 120, name: live.name })).status, 200);
    assert.equal((await world.call('PATCH', `/products/${live.id}`, world.admin, { description: 'tidied by the platform' })).status, 200);

    assert.equal((await audits(draft.id)).length, 0);
    assert.equal((await audits(live.id)).length, 0);
    assert.equal((await mails(live.id)).length, 0);
  });
});
