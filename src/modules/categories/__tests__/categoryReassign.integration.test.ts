import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { SKIP_ON_DEV_DB, rows, startCatalogWorld, type CatalogWorld } from '../../../testHelpers/catalogFixtures';

let world: CatalogWorld;

describe('bulk reassigning products', { skip: SKIP_ON_DEV_DB }, () => {
  before(async () => {
    world = await startCatalogWorld();
  });
  after(async () => {
    await world.close();
  });

  const categoryOf = async (id: string) =>
    (await rows<{ categoryId: string }>('SELECT "categoryId" FROM products WHERE id = :id', { id }))[0]!.categoryId;

  /** A category that asks for a food licence the fixture vendors do not hold. */
  async function licensedCategory() {
    const category = await world.category();
    await rows(
      `INSERT INTO document_requirements (id, "categoryId", "documentType", "isMandatory", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), :id, 'FSSAI_LICENSE', true, now(), now()) RETURNING id`,
      { id: category.id },
    );
    return category;
  }

  it('moves nothing while a vendor with live products lacks the documents (bug 9)', async () => {
    const from = await world.category();
    const to = await licensedCategory();
    const product = await world.liveProduct(world.a, { categoryId: from.id });
    const body = { fromCategoryId: from.id, toCategoryId: to.id };

    const impact = await world.call('GET', `/categories/rate-impact?kind=reassign&fromCategoryId=${from.id}&toCategoryId=${to.id}`, world.admin);
    assert.equal(impact.data.blockedVendors[0]?.vendorId, world.a.id, impact.text);

    const reply = await world.call('POST', '/categories/reassign-products', world.admin, body);
    assert.equal(reply.status, 422, reply.text);
    assert.match(reply.error.details.vendors[0].businessName, /Fixture Store/);
    assert.equal(await categoryOf(product.id), from.id);
  });

  it('moves deleted products too, and drops a secondary tag that became the primary (M10)', async () => {
    const from = await world.category();
    const to = await world.category();
    const kept = await world.draftProduct(world.a, { categoryId: from.id });
    const deleted = await world.draftProduct(world.a, { categoryId: from.id });
    await world.call('PATCH', `/products/${kept.id}`, world.a.owner, { secondaryCategoryIds: [to.id] });
    world.expectStatus(await world.call('DELETE', `/products/${deleted.id}`, world.a.owner), 204, 'delete');

    const reply = await world.call('POST', '/categories/reassign-products', world.admin, { fromCategoryId: from.id, toCategoryId: to.id });
    assert.equal(reply.data.updatedCount, 1, reply.text);
    assert.equal(await categoryOf(kept.id), to.id);
    assert.equal(await categoryOf(deleted.id), to.id);
    const links = await rows('SELECT 1 FROM product_categories WHERE "productId" = :id AND "deletedAt" IS NULL', { id: kept.id });
    assert.equal(links.length, 0);
  });
});
