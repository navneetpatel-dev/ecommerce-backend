import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { SKIP_ON_DEV_DB, rows, startCatalogWorld, unique, type CatalogWorld } from '../../../testHelpers/catalogFixtures';

let world: CatalogWorld;

describe('what the platform charges is never shown to shoppers', { skip: SKIP_ON_DEV_DB }, () => {
  before(async () => {
    world = await startCatalogWorld();
  });
  after(async () => {
    await world.close();
  });

  it('no anonymous or customer response carries a commission rate', async () => {
    const parent = await world.category({ commissionRate: 7.25 });
    const child = await world.category({ parentId: parent.id, commissionRate: 12.5 });
    const name = `Commission Probe ${unique()}`;
    const product = await world.liveProduct(world.a, { categoryId: child.id, name });
    await world.call('POST', '/cart/items', world.customer, { variantId: product.variantId, quantity: 1 });
    await world.call('POST', '/wishlist/items', world.customer, { productId: product.id });
    await world.call('POST', '/products/recently-viewed', world.customer, { productId: product.id });
    await rows(
      `INSERT INTO product_affinities (id, "productId", "relatedProductId", score, "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), :id, :id, 1, now(), now()) RETURNING id`,
      { id: product.id },
    ).catch(() => []);
    const [vendor] = await rows<{ slug: string }>('SELECT slug FROM vendors WHERE id = :id', { id: world.a.id });

    const paths = [
      `/products?categoryId=${child.id}`, `/products/${product.id}`, `/products/slug/${product.slug}`,
      `/products/${product.id}/frequently-bought-together`, `/search?q=${encodeURIComponent(name)}`,
      `/search/autocomplete?q=${encodeURIComponent(name)}`, '/categories', `/categories?page=1&limit=5`, `/categories/${child.id}`,
      `/categories/resolve?path=${parent.slug}/${child.slug}`, `/categories/${child.id}/facets`,
      `/vendors/slug/${vendor!.slug}`, '/vendors/storefront', '/homepage/banners', `/reviews/product/${product.id}`,
    ];
    const signedIn = ['/cart', '/wishlist', '/products/recently-viewed'];
    let read = 0;
    for (const who of [null, world.customer, world.b.owner]) {
      for (const path of [...paths, ...(who === world.customer ? signedIn : [])]) {
        const reply = await world.call('GET', path, who);
        if (reply.status === 200) read += 1;
        assert.doesNotMatch(reply.text, /"commissionRate":\s*"?\d/, `${path} as ${who?.email ?? 'guest'}`);
      }
    }
    assert.ok(read > 25, `only ${read} responses were readable`);
  });

  it('the owning store and the platform still see it', async () => {
    const category = await world.category({ commissionRate: 11 });
    const product = await world.liveProduct(world.a, { categoryId: category.id });
    for (const who of [world.a.owner, world.admin]) {
      assert.match((await world.call('GET', `/products/${product.id}`, who)).text, /"commissionRate":"11\.00"/);
    }
  });
});
