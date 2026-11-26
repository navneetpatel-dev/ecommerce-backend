import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { sequelize } from '@database/models';
import { AuditLog } from '@database/models/auditLog.model';
import { Category } from '@database/models/category.model';
import { TaxRule } from '@database/models/taxRule.model';
import { categoriesRepository } from '../categories.repository';
import { categoriesService } from '../categories.service';
import { placeAmongSiblings } from '../categoryMove';
import { toPublicCategory } from '../categoryPublic';
import { CreateCategoryAttributeSchema, CreateCategorySchema, MoveCategorySchema, UpdateCategorySchema } from '../categories.dto';

const status = (e: unknown) => (e as { statusCode?: number }).statusCode;
const tx = () => mock.method(sequelize, 'transaction', async (callback: (t: object) => Promise<unknown>) => callback({}));

describe('what the public API returns of a category', () => {
  it('drops the commission and who changed it, on the category and its subcategories and parent', () => {
    const publicView = toPublicCategory({
      id: 'a', name: 'Apparel', commissionRate: 7.5, createdBy: 'u1', updatedBy: 'u2', deletedBy: null, returnWindowDays: 7,
      parent: { id: 'p', commissionRate: 5 },
      children: [{ id: 'b', commissionRate: 9, createdBy: 'u1', children: [{ id: 'c', commissionRate: 1 }] }],
    });
    assert.equal(JSON.stringify(publicView).includes('commissionRate'), false);
    assert.equal(JSON.stringify(publicView).includes('createdBy'), false);
    assert.equal(publicView.returnWindowDays, 7, 'customer-relevant fields stay');
  });
});

describe('moving a category among its siblings', () => {
  it('places it before, after, or last; refuses an anchor that is not a sibling', () => {
    assert.deepEqual(placeAmongSiblings(['a', 'b', 'c'], 'x', { beforeId: 'b' }), ['a', 'x', 'b', 'c']);
    assert.deepEqual(placeAmongSiblings(['a', 'b', 'c'], 'x', { afterId: 'b' }), ['a', 'b', 'x', 'c']);
    assert.deepEqual(placeAmongSiblings(['a', 'b', 'c'], 'x', {}), ['a', 'b', 'c', 'x']);
    assert.equal(placeAmongSiblings(['a', 'b'], 'x', { beforeId: 'zzz' }), null);
  });

  it('moving within the group does not duplicate it', () => {
    assert.deepEqual(placeAmongSiblings(['a', 'b', 'c'], 'c', { beforeId: 'a' }), ['c', 'a', 'b']);
    assert.deepEqual(placeAmongSiblings(['a', 'b', 'c'], 'a', { afterId: 'c' }), ['b', 'c', 'a']);
  });
});

describe('category input', () => {
  const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => assert.equal(schema.safeParse(v).success, true, JSON.stringify(v).slice(0, 80));
  const bad = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => assert.equal(schema.safeParse(v).success, false, JSON.stringify(v).slice(0, 80));

  it('names are trimmed and 1 to 100 characters', () => {
    assert.equal(CreateCategorySchema.parse({ name: '  Home  ' }).name, 'Home');
    ok(CreateCategorySchema, { name: 'n'.repeat(100) });
    for (const name of ['', '   ', 'n'.repeat(101)]) bad(CreateCategorySchema, { name });
    bad(UpdateCategorySchema, { name: 'n'.repeat(101) });
  });

  it('attributes: name up to 60, at most 50 options of up to 100 characters', () => {
    const attribute = { type: 'ENUM', name: 'Size' };
    ok(CreateCategoryAttributeSchema, { ...attribute, options: Array.from({ length: 50 }, (_, i) => `o${i}`) });
    bad(CreateCategoryAttributeSchema, { ...attribute, options: Array.from({ length: 51 }, (_, i) => `o${i}`) });
    bad(CreateCategoryAttributeSchema, { ...attribute, options: ['x'.repeat(101)] });
    bad(CreateCategoryAttributeSchema, { ...attribute, name: 'n'.repeat(61) });
  });

  it('a move names at most one anchor', () => {
    ok(MoveCategorySchema, { afterId: '11111111-1111-4111-8111-111111111111' });
    bad(MoveCategorySchema, { beforeId: '11111111-1111-4111-8111-111111111111', afterId: '22222222-2222-4222-8222-222222222222' });
    ok(MoveCategorySchema, { parentId: null });
  });
});

describe('categoriesService.updateCategory', () => {
  afterEach(() => mock.restoreAll());

  function setup(stored: Record<string, unknown>, activeBelow = 0) {
    tx();
    const updates: Array<Record<string, unknown>> = [];
    mock.method(categoriesRepository, 'findById', async () => stored as never);
    mock.method(categoriesRepository, 'update', async (_id: string, data: Record<string, unknown>) => {
      updates.push(data);
      return undefined as never;
    });
    mock.method(categoriesRepository, 'findBySlug', async () => null as never);
    mock.method(categoriesRepository, 'findDescendantIds', async () => ['c1', 'child-1', 'child-2'].slice(0, activeBelow + 1));
    const childUpdate = mock.method(Category, 'update', async () => [activeBelow] as never);
    mock.method(Category, 'count', async () => activeBelow as never);
    mock.method(categoriesService, 'getCategoryById', async () => ({ id: 'c1' }) as never);
    return { updates, childUpdate };
  }

  it('a rename keeps the URL slug (links keep working) unless a new one is asked for', async () => {
    const { updates } = setup({ id: 'c1', name: 'Old', slug: 'old', status: 'ACTIVE', imageUrl: null });
    await categoriesService.updateCategory('c1', { name: 'Brand New' } as never);
    assert.equal(updates[0]!.name, 'Brand New');
    assert.equal('slug' in updates[0]!, false);
    await categoriesService.updateCategory('c1', { name: 'Brand New', regenerateSlug: true } as never);
    assert.equal(updates[1]!.slug, 'brand-new');
  });

  it('archiving a category with active subcategories needs cascade (422), and cascade archives them', async () => {
    const { updates, childUpdate } = setup({ id: 'c1', name: 'Home', slug: 'home', status: 'ACTIVE', imageUrl: null }, 2);
    await assert.rejects(categoriesService.updateCategory('c1', { status: 'ARCHIVED' } as never), (e) => status(e) === 422 && /subcategories/.test((e as Error).message));
    assert.equal(updates.length, 0);
    await categoriesService.updateCategory('c1', { status: 'ARCHIVED', cascade: true } as never);
    assert.equal(childUpdate.mock.callCount(), 1);
    assert.equal(updates[0]!.status, 'ARCHIVED');
  });

  it('archiving a category with no active subcategories needs nothing extra', async () => {
    const { updates } = setup({ id: 'c1', name: 'Home', slug: 'home', status: 'ACTIVE', imageUrl: null }, 0);
    await categoriesService.updateCategory('c1', { status: 'ARCHIVED' } as never);
    assert.equal(updates[0]!.status, 'ARCHIVED');
  });
});

describe('categoriesService.deleteCategory and reorder', () => {
  afterEach(() => mock.restoreAll());

  it('deleting a category removes its tax rule first (otherwise it would become a second default) and audits that', async () => {
    tx();
    const destroyRule = mock.fn(async () => undefined);
    const audits: Array<Record<string, any>> = [];
    mock.method(categoriesRepository, 'findWithChildren', async () => ({ id: 'c1', name: 'Apparel', imageUrl: null, children: [] }) as never);
    mock.method(categoriesRepository, 'countProducts', async () => 0);
    mock.method(TaxRule, 'findOne', async () => ({ id: 'r1', gstPercentage: '12', destroy: destroyRule }) as never);
    const del = mock.method(categoriesRepository, 'delete', async () => undefined as never);
    mock.method(AuditLog, 'create', async (row: Record<string, unknown>) => {
      audits.push(row);
      return {} as never;
    });
    await categoriesService.deleteCategory('c1', 'admin-1');
    assert.equal(destroyRule.mock.callCount(), 1);
    assert.equal(del.mock.callCount(), 1);
    assert.equal(audits[0]!.action, 'TAX_RULE_DELETED');
    assert.equal(audits[0]!.metadata.reason, 'category deleted');
  });

  it('a whole-list reorder across different parents is refused (422)', async () => {
    tx();
    mock.method(Category, 'findAll', async () => [{ parentId: 'a' }, { parentId: 'b' }] as never);
    await assert.rejects(categoriesService.reorderCategories(['x', 'y']), (e) => status(e) === 422);
  });
});
