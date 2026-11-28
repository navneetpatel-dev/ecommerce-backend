import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { SKIP_ON_DEV_DB, rows, startCatalogWorld, unique, type CatalogWorld } from '../../../testHelpers/catalogFixtures';

let world: CatalogWorld;

describe('finding products by category', { skip: SKIP_ON_DEV_DB }, () => {
  before(async () => {
    world = await startCatalogWorld();
  });
  after(async () => {
    await world.close();
  });

  const listed = async (path: string) => (await world.call('GET', path)).data.map((row: any) => row.id) as string[];

  it('search and browse under a parent find its subcategories (M11)', async () => {
    const parent = await world.category();
    const child = await world.category({ parentId: parent.id });
    const name = `Parentfind ${unique()}`;
    const product = await world.liveProduct(world.a, { categoryId: child.id, name });
    assert.ok((await listed(`/search?q=${encodeURIComponent(name)}&categoryId=${parent.id}`)).includes(product.id));
    assert.ok((await listed(`/products?categoryId=${parent.id}&includeDescendants=true`)).includes(product.id));
  });

  it('a secondary category lists, filters and searches the product (M13)', async () => {
    const tag = await world.category();
    const name = `Tagged ${unique()}`;
    const product = await world.liveProduct(world.a, { name });
    await world.call('PATCH', `/products/${product.id}`, world.a.owner, { secondaryCategoryIds: [tag.id] });
    assert.deepEqual(await listed(`/products?categoryId=${tag.id}&includeDescendants=true`), [product.id]);
    assert.deepEqual(await listed(`/search?q=${encodeURIComponent(name)}&categoryId=${tag.id}`), [product.id]);
    // The vendor's own table filters by the primary category only.
    assert.deepEqual(await (async () => (await world.call('GET', `/products?vendorId=${world.a.id}&categoryId=${tag.id}`, world.a.owner)).data)(), []);
  });

  it('a parent page never shows products of an archived subcategory', async () => {
    const parent = await world.category();
    const child = await world.category({ parentId: parent.id });
    const product = await world.liveProduct(world.a, { categoryId: child.id });
    world.expectStatus(await world.call('PATCH', `/categories/${child.id}`, world.admin, { status: 'ARCHIVED' }), 200, 'archive');
    assert.ok(!(await listed(`/products?categoryId=${parent.id}&includeDescendants=true`)).includes(product.id));
  });

  it('filters match option names whatever the capitals, and new variants are spelt like the filter (M12)', async () => {
    const category = await world.category();
    world.expectStatus(
      await world.call('POST', `/categories/${category.id}/attributes`, world.admin, { name: 'Colour', type: 'ENUM', options: ['Red'] }),
      201, 'attribute',
    );
    const product = await world.liveProduct(world.a, { categoryId: category.id });
    const countRed = async () => (await world.call('GET', `/categories/${category.id}/facets`)).data.facets[0].options[0].count;

    await rows('UPDATE product_variants SET attributes = \'{"colour":"red"}\' WHERE id = :id RETURNING id', { id: product.variantId });
    assert.equal(await countRed(), 1);
    assert.deepEqual(await listed(`/products?categoryId=${category.id}&colour=Red`), [product.id]);

    const saved = await world.call('PATCH', `/products/variants/${product.variantId}`, world.a.owner, { attributes: { colour: 'Red', Note: 'x' } });
    assert.deepEqual(saved.data.attributes, { Colour: 'Red', Note: 'x' }, saved.text);
  });

  it('refuses to delete a category holding deleted products until they are moved (M10)', async () => {
    const from = await world.category();
    const to = await world.category();
    const product = await world.draftProduct(world.a, { categoryId: from.id });
    await world.call('DELETE', `/products/${product.id}`, world.a.owner);

    const refused = await world.call('DELETE', `/categories/${from.id}`, world.admin);
    assert.equal(refused.status, 422, refused.text);
    const impact = await world.call('GET', `/categories/admin/${from.id}/impact`, world.admin);
    assert.equal(impact.data.deletedProductCount, 1, impact.text);
    world.expectStatus(await world.call('POST', '/categories/reassign-products', world.admin, { fromCategoryId: from.id, toCategoryId: to.id }), 200, 'move');
    assert.equal((await world.call('DELETE', `/categories/${from.id}`, world.admin)).status, 204);
  });

  it('says how many products use a category as a secondary tag (E7)', async () => {
    const tag = await world.category();
    const product = await world.draftProduct(world.a);
    await world.call('PATCH', `/products/${product.id}`, world.a.owner, { secondaryCategoryIds: [tag.id] });
    assert.equal((await world.call('GET', `/categories/admin/${tag.id}/impact`, world.admin)).data.secondaryCount, 1);
  });

  it('refuses a second category of the same name under one parent (L5)', async () => {
    const parent = await world.category();
    const other = await world.category();
    const name = `Twin ${unique()}`;
    const first = await world.category({ parentId: parent.id, name });
    const second = await world.category({ parentId: parent.id });
    const rename = await world.call('PATCH', `/categories/${second.id}`, world.admin, { name: name.toUpperCase() });
    assert.equal(rename.status, 422, rename.text);
    const elsewhere = await world.category({ parentId: other.id, name });
    assert.equal((await world.call('PATCH', `/categories/${elsewhere.id}/move`, world.admin, { parentId: parent.id })).status, 422);
    assert.ok(first.id);
  });

  it('the default tax rule cannot be moved to a category (M14)', async () => {
    const [fallback] = await rows<{ id: string }>('SELECT id FROM tax_rules WHERE "categoryId" IS NULL AND "deletedAt" IS NULL');
    const reply = await world.call('PATCH', `/tax/rules/${fallback!.id}`, world.admin, { categoryId: (await world.category()).id });
    assert.equal(reply.status, 422, reply.text);
  });

  it('a removed option stays named in the cart and blocks the checkout (L3)', async () => {
    const name = `Gone ${unique()}`;
    const product = await world.liveProduct(world.a, { name });
    await world.call('POST', `/products/${product.id}/variants`, world.a.owner, { sku: `KEEP-${unique()}`, price: 120, stock: 3 });
    await world.call('POST', '/cart/items', world.customer, { variantId: product.variantId, quantity: 1 });
    world.expectStatus(await world.call('DELETE', `/products/variants/${product.variantId}`, world.a.owner), 204, 'remove');

    const cart = await world.call('GET', '/cart', world.customer);
    const line = cart.data.items.find((item: any) => item.variantId === product.variantId);
    assert.equal(line.product.name, name, cart.text.slice(0, 200));
    assert.equal(line.unavailableReason, 'VARIANT_REMOVED');
    assert.ok(line.product.price > 0);
    const quote = await world.call('POST', '/checkout/quote', world.customer, { shippingAddressId: world.addressId });
    assert.equal(quote.error.details.items[0].unavailableReason, 'VARIANT_REMOVED', quote.text);
  });
});
