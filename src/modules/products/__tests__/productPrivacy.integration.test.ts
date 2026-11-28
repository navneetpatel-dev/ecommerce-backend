import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { SKIP_ON_DEV_DB, unique, type CatalogWorld, startCatalogWorld } from '../../../testHelpers/catalogFixtures';

let world: CatalogWorld;
let draft: Awaited<ReturnType<CatalogWorld['draftProduct']>>;
let live: Awaited<ReturnType<CatalogWorld['liveProduct']>>;

/** Anything that would give away a seller's bank account. */
const BANK = /bankDetails|accountNumber|ifscCode|accountHolderName/;

describe("one vendor never sees another's private data", { skip: SKIP_ON_DEV_DB }, () => {
  before(async () => {
    world = await startCatalogWorld();
    live = await world.liveProduct(world.a, { name: `Privacy Live ${unique()}` });
    draft = await world.draftProduct(world.a, { name: `Privacy Draft ${unique()}` });
    await world.call('POST', '/cart/items', world.customer, { variantId: live.variantId, quantity: 1 });
    world.expectStatus(
      await world.call('POST', '/checkout', world.customer, { shippingAddressId: world.addressId, billingAddressId: world.addressId, paymentMethod: 'COD' }, { 'idempotency-key': unique() }),
      201, 'place order',
    );
  });
  after(async () => {
    await world.close();
  });

  it("another vendor's draft is not found, by id or by slug", async () => {
    for (const who of [world.b.owner, world.b.staff, world.customer, world.orders, null]) {
      assert.equal((await world.call('GET', `/products/${draft.id}`, who)).status, 404);
      assert.equal((await world.call('GET', `/products/slug/${draft.slug}`, who)).status, 404);
    }
  });

  it('the owning store and catalog admins still see the draft with the team fields', async () => {
    for (const who of [world.a.owner, world.a.staff, world.catalog, world.admin]) {
      const byId = await world.call('GET', `/products/${draft.id}`, who);
      assert.equal(byId.status, 200, byId.text);
      assert.equal(byId.data.status, 'DRAFT');
      assert.ok('rejectionNote' in byId.data);
      assert.equal((await world.call('GET', `/products/slug/${draft.slug}`, who)).status, 200);
    }
  });

  it("another vendor sees only the shopper's view of a live product", async () => {
    const reply = await world.call('GET', `/products/${live.id}`, world.b.owner);
    assert.equal(reply.status, 200);
    assert.equal('rejectionNote' in reply.data, false);
    assert.equal('gstNumber' in reply.data.vendor, false);
  });

  it('no product, order, sub-order, cart or wishlist response carries bank details', async () => {
    await world.call('POST', '/wishlist/items', world.customer, { productId: live.id });
    const everyone = [world.a.owner, world.a.staff, world.b.owner, world.b.staff, world.admin, world.catalog, world.orders, world.customer, null];
    const paths = [
      `/products?vendorId=${world.a.id}&limit=5`, `/products/${live.id}`, `/products/slug/${live.slug}`,
      `/products/${draft.id}`, '/suborders?limit=5', `/suborders?vendorId=${world.a.id}`, '/orders?limit=5', '/cart', '/wishlist',
    ];
    const seen: string[] = [];
    for (const who of everyone) {
      for (const path of paths) {
        const reply = await world.call('GET', path, who);
        if (reply.status === 200) seen.push(path);
        assert.doesNotMatch(reply.text, BANK, `${path} as ${who?.email ?? 'guest'}`);
      }
    }
    assert.ok(seen.includes('/suborders?limit=5'), 'the sub-order list was actually read');
  });

  it('a status change on a part answers without bank details (E1)', async () => {
    const list = await world.call('GET', '/suborders?limit=1', world.a.owner);
    const part = list.data[0] ?? list.data.suborders?.[0];
    assert.ok(part, list.text.slice(0, 200));
    const reply = await world.call('PATCH', `/suborders/${part.id}/status`, world.a.staff, { status: 'CONFIRMED' });
    assert.doesNotMatch(reply.text, BANK);
  });
});
