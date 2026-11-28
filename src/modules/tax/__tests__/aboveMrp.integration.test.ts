import assert from 'node:assert/strict';
import { after, before, describe, it, mock } from 'node:test';
import { notificationsService } from '@modules/notifications/notifications.service';
import { refreshAllProductDisplayPrices } from '@modules/products/productPricingState';
import { SKIP_ON_DEV_DB, rows, startCatalogWorld, unique, type CatalogWorld } from '../../../testHelpers/catalogFixtures';

let world: CatalogWorld;

describe('nothing sells above its MRP (bug 10)', { skip: SKIP_ON_DEV_DB }, () => {
  before(async () => {
    world = await startCatalogWorld();
  });
  after(async () => {
    mock.restoreAll();
    await world.close();
  });

  const flags = async (productId: string) =>
    rows<{ price: string; variant: boolean; product: boolean }>(
      `SELECT v.price, v."aboveMrp" AS variant, p."aboveMrp" AS product FROM product_variants v JOIN products p ON p.id = v."productId"
       WHERE p.id = :productId AND v."deletedAt" IS NULL ORDER BY v.price`,
      { productId },
    );

  /** GST 5%: ₹100 and ₹150 both sell within an MRP of ₹170. */
  async function taxedProduct() {
    const category = await world.category();
    const rule = world.expectStatus(
      await world.call('POST', '/tax/rules', world.admin, { categoryId: category.id, gstPercentage: 5 }), 201, 'rule',
    ).data;
    const name = `Mrp Probe ${unique()}`;
    const product = await world.liveProduct(world.a, { categoryId: category.id, name, price: 100 });
    world.expectStatus(await world.call('PATCH', `/products/${product.id}`, world.a.owner, { compareAtPrice: 170 }), 200, 'mrp');
    const dear = world.expectStatus(
      await world.call('POST', `/products/${product.id}/variants`, world.a.owner, { sku: `DEAR-${unique()}`, price: 150, stock: 5 }),
      201, 'variant',
    ).data;
    return { ...product, category, rule, dearId: dear.id as string };
  }
  /** Changing the rule refreshes in the background; the test runs the same refresh and waits for it. */
  async function raiseGst(ruleId: string, gstPercentage: number) {
    world.expectStatus(await world.call('PATCH', `/tax/rules/${ruleId}`, world.admin, { gstPercentage }), 200, 'raise');
    await refreshAllProductDisplayPrices();
  }

  it('says beforehand what a rate rise would take off sale', async () => {
    const product = await taxedProduct();
    const impact = await world.call('POST', '/tax/rules/impact', world.admin, { action: 'update', ruleId: product.rule.id, rule: { gstPercentage: 28 } });
    assert.deepEqual(impact.data, { productCount: 1, variantCount: 1, vendorCount: 1 }, impact.text);
    assert.deepEqual((await flags(product.id)).map((row) => row.variant), [false, false]);
  });

  it('stops only the option above the MRP, everywhere, and tells the vendor once', async () => {
    const product = await taxedProduct();
    await world.call('POST', '/cart/items', world.customer, { variantId: product.dearId, quantity: 1 });
    const sent: Array<{ type: string; userId?: string | null }> = [];
    mock.method(notificationsService, 'enqueue', (async (params: { type: string; userId?: string }) => {
      sent.push(params);
      return {} as never;
    }) as never);

    await raiseGst(product.rule.id, 28); // 150 -> 192 > 170; 100 -> 128

    assert.deepEqual((await flags(product.id)).map((row) => [row.variant, row.product]), [[false, false], [true, false]]);
    const page = await world.call('GET', `/products/${product.id}`, world.customer);
    assert.deepEqual(page.data.variants.map((v: any) => [Number(v.price), v.aboveMrp]).sort(), [[100, false], [150, true]]);

    const cart = await world.call('GET', '/cart', world.customer);
    assert.equal(cart.data.items.find((item: any) => item.variantId === product.dearId).unavailableReason, 'PRICE_ABOVE_MRP');
    assert.equal((await world.call('POST', '/checkout/quote', world.customer, { shippingAddressId: world.addressId })).status, 422);
    const add = await world.call('POST', '/cart/items', world.customer, { variantId: product.dearId, quantity: 1 });
    assert.equal(add.error?.code, 'ITEM_ABOVE_MRP', add.text);
    assert.equal((await world.call('POST', '/cart/items', world.customer, { variantId: product.variantId, quantity: 1 })).status, 201);

    const told = sent.filter((entry) => entry.type === 'PRODUCT_ABOVE_MRP' && entry.userId === world.a.owner.id);
    assert.equal(told.length, 1, 'one email to the vendor');
    await refreshAllProductDisplayPrices();
    assert.equal(sent.filter((entry) => entry.type === 'PRODUCT_ABOVE_MRP' && entry.userId === world.a.owner.id).length, 1);
  });

  it('hides a listing whose every option is above the MRP, until the vendor corrects it', async () => {
    const product = await taxedProduct();
    await world.call('PATCH', `/products/${product.id}`, world.a.owner, { compareAtPrice: 158 });
    await raiseGst(product.rule.id, 80);

    assert.equal((await world.call('GET', `/products/${product.id}`, world.customer)).status, 404);
    const list = await world.call('GET', `/products?categoryId=${product.category.id}`);
    assert.equal(list.data.length, 0);
    const search = await world.call('GET', `/search?q=${encodeURIComponent(product.name)}`);
    assert.ok(!search.text.includes(product.id));
    // The vendor still sees it and can fix it.
    assert.equal((await world.call('GET', `/products/${product.id}`, world.a.owner)).data.aboveMrp, true);
    world.expectStatus(await world.call('PATCH', `/products/${product.id}`, world.a.owner, { compareAtPrice: 300 }), 200, 'fix');
    assert.equal((await world.call('GET', `/products/${product.id}`, world.customer)).status, 200);
  });
});
