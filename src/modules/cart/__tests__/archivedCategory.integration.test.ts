import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { SKIP_ON_DEV_DB, rows, startCatalogWorld, unique, type CatalogWorld } from '../../../testHelpers/catalogFixtures';

let world: CatalogWorld;

describe('an item in an archived category cannot be bought', { skip: SKIP_ON_DEV_DB }, () => {
  before(async () => {
    world = await startCatalogWorld();
  });
  after(async () => {
    await world.close();
  });

  const checkout = () =>
    world.call(
      'POST', '/checkout', world.customer,
      { shippingAddressId: world.addressId, billingAddressId: world.addressId, paymentMethod: 'COD' },
      { 'idempotency-key': unique() },
    );
  const archive = (id: string) => world.call('PATCH', `/categories/${id}`, world.admin, { status: 'ARCHIVED', cascade: true });

  it('cart, quote, order, wishlist and short link all treat it as off sale', async () => {
    const product = await world.liveProduct(world.a);
    world.expectStatus(await world.call('POST', '/cart/items', world.customer, { variantId: product.variantId, quantity: 1 }), 201, 'add');
    world.expectStatus(await archive(product.categoryId), 200, 'archive');

    const cart = await world.call('GET', '/cart', world.customer);
    const line = cart.data.items.find((item: any) => item.variantId === product.variantId);
    assert.equal(line.isAvailable, false);
    assert.equal(line.unavailableReason, 'PRODUCT_UNPUBLISHED');

    const quote = await world.call('POST', '/checkout/quote', world.customer, { shippingAddressId: world.addressId });
    assert.equal(quote.status, 422, quote.text);
    assert.equal((await checkout()).status, 422);
    const [count] = await rows<{ n: number }>('SELECT COUNT(*)::int AS n FROM order_items WHERE "variantId" = :id', { id: product.variantId });
    assert.equal(count!.n, 0);

    assert.equal((await world.call('POST', '/cart/items', world.customer, { variantId: product.variantId, quantity: 1 })).status, 404);
    assert.equal((await world.call('POST', '/wishlist/items', world.customer, { productId: product.id })).status, 404);
    const link = await world.call('POST', '/short-links', world.customer, { targetUrl: `/products/${product.slug}`, resourceType: 'PRODUCT', resourceId: product.id });
    assert.equal(link.data?.metadata ?? null, null, link.text);
  });

  it('a subcategory cannot be created, reactivated or moved active under an archived parent (M9)', async () => {
    const parent = await world.category();
    const child = await world.category({ parentId: parent.id });
    const loose = await world.category();
    world.expectStatus(await archive(parent.id), 200, 'archive parent');

    const reactivate = await world.call('PATCH', `/categories/${child.id}`, world.admin, { status: 'ACTIVE' });
    assert.equal(reactivate.status, 422, reactivate.text);
    const created = await world.call('POST', '/categories', world.admin, { name: `Under archived ${unique()}`, parentId: parent.id });
    assert.equal(created.status, 422, created.text);
    assert.equal((await world.call('PATCH', `/categories/${loose.id}/move`, world.admin, { parentId: parent.id })).status, 422);
    assert.equal((await world.call('PATCH', `/categories/${loose.id}`, world.admin, { parentId: parent.id })).status, 422);
    // An archived subcategory may still be filed there.
    const archived = await world.call('POST', '/categories', world.admin, { name: `Filed ${unique()}`, parentId: parent.id, status: 'ARCHIVED' });
    assert.equal(archived.status, 201, archived.text);
  });
});
