import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { AuditLog } from '@database/models/auditLog.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { User } from '@database/models/user.model';
import { clearPermissionCache, setPermissionCache } from '@middleware/rbac.middleware';
import { ROLE_PERMISSIONS } from '@core/permissions/permissionKeys';
import { ROLES } from '@core/constants/statuses';
import { changedPricingFields, variantPriceChanged } from '../productPricingRules';
import { productsRepository } from '../products.repository';
import { productsService } from '../products.service';
import * as productsController from '../products.controller';

const forbidden = (e: unknown) => (e as { statusCode?: number }).statusCode === 403 && /store owner/.test((e as Error).message);

describe('changedPricingFields', () => {
  const stored = { basePrice: '499.00', compareAtPrice: '699.00', hsnCode: '610910', codEnabled: null };

  it('ignores fields that are not sent or are sent back unchanged (a form submitting the whole product)', () => {
    assert.deepEqual(changedPricingFields(stored, {}), []);
    assert.deepEqual(changedPricingFields(stored, { basePrice: 499, compareAtPrice: 699, hsnCode: '610910', codEnabled: null }), []);
    assert.deepEqual(changedPricingFields(stored, { basePrice: '499', hsnCode: ' 610910 ' }), []);
    // codEnabled: null (inherit) vs an explicit false are different; null vs undefined is not a change
    assert.deepEqual(changedPricingFields({ codEnabled: true }, { codEnabled: true }), []);
    // "no value" is the same however it is written
    assert.deepEqual(changedPricingFields({ compareAtPrice: null, hsnCode: null }, { compareAtPrice: null, hsnCode: '' }), []);
  });

  it('reports every pricing field that really changes', () => {
    assert.deepEqual(changedPricingFields(stored, { basePrice: 450 }), ['basePrice']);
    assert.deepEqual(changedPricingFields(stored, { compareAtPrice: null }), ['compareAtPrice']);
    assert.deepEqual(changedPricingFields(stored, { hsnCode: '620000' }), ['hsnCode']);
    assert.deepEqual(changedPricingFields(stored, { codEnabled: false }), ['codEnabled']);
    assert.deepEqual(changedPricingFields(stored, { basePrice: 1, compareAtPrice: 2, hsnCode: 'x', codEnabled: true }).sort(), ['basePrice', 'codEnabled', 'compareAtPrice', 'hsnCode']);
    assert.deepEqual(changedPricingFields({ compareAtPrice: null }, { compareAtPrice: 999 }), ['compareAtPrice']);
    // A leading zero is a different HSN code, not a numerically equal one.
    assert.deepEqual(changedPricingFields({ hsnCode: '0610' }, { hsnCode: '610' }), ['hsnCode']);
  });

  it('variantPriceChanged', () => {
    assert.equal(variantPriceChanged('99.00', undefined), false);
    assert.equal(variantPriceChanged('99.00', 99), false);
    assert.equal(variantPriceChanged('99.00', 89), true);
  });
});

const product = (over: Record<string, unknown> = {}) =>
  ({ id: 'p1', vendorId: 'v1', basePrice: '499.00', compareAtPrice: '699.00', hsnCode: '610910', codEnabled: null, categoryId: null, ...over }) as never;

describe('productsService.updateProduct for vendor staff (canEditPricing: false)', () => {
  const SENTINEL = new Error('REACHED_WRITE');
  afterEach(() => mock.restoreAll());

  it('refuses a changed price, MRP, HSN code or COD setting', async () => {
    mock.method(productsRepository, 'findById', async () => product());
    for (const change of [{ basePrice: 450 }, { compareAtPrice: 650 }, { hsnCode: '620000' }, { codEnabled: false }]) {
      await assert.rejects(
        productsService.updateProduct(randomUUID(), 'v1', change as never, { canEditPricing: false }),
        forbidden,
        JSON.stringify(change),
      );
    }
  });

  it('lets staff edit everything else, even when the form re-sends the unchanged prices', async () => {
    mock.method(productsRepository, 'findById', async () => product());
    mock.method(productsRepository, 'update', async () => {
      throw SENTINEL;
    });
    for (const edit of [{ name: 'Blue shirt' }, { description: 'New copy' }, { basePrice: 499, compareAtPrice: 699, hsnCode: '610910', name: 'x' }]) {
      await assert.rejects(
        productsService.updateProduct(randomUUID(), 'v1', edit as never, { canEditPricing: false }),
        (e) => e === SENTINEL,
        `${JSON.stringify(edit)} must reach the write`,
      );
    }
  });

  it('is unrestricted for owners/admins (canEditPricing true) and for internal callers (no option)', async () => {
    mock.method(productsRepository, 'findById', async () => product());
    mock.method(productsRepository, 'update', async () => {
      throw SENTINEL;
    });
    await assert.rejects(productsService.updateProduct(randomUUID(), 'v1', { basePrice: 450 } as never, { canEditPricing: true }), (e) => e === SENTINEL);
    await assert.rejects(productsService.updateProduct(randomUUID(), 'v1', { basePrice: 450 } as never), (e) => e === SENTINEL);
  });

  it('still refuses another store’s product before anything else', async () => {
    mock.method(productsRepository, 'findById', async () => product({ vendorId: 'other' }));
    await assert.rejects(
      productsService.updateProduct(randomUUID(), 'v1', { name: 'x' } as never, { canEditPricing: false }),
      (e: { statusCode?: number }) => e.statusCode === 403,
    );
  });
});

describe('variants for vendor staff', () => {
  afterEach(() => mock.restoreAll());

  it('adding a variant (it sets a price) is refused before touching the database', async () => {
    const findById = mock.method(productsRepository, 'findById', async () => product());
    await assert.rejects(productsService.addVariant('p1', { sku: 'S1', price: 100 } as never, { canEditPricing: false }), forbidden);
    assert.equal(findById.mock.callCount(), 0);
  });

  it('changing a variant price is refused; changing stock only is not', async () => {
    const SENTINEL = new Error('REACHED_WRITE');
    const row = { productId: 'p1', price: '100.00', stock: 5, update: async () => { throw SENTINEL; } };
    mock.method(ProductVariant, 'findByPk', async () => row as never);
    await assert.rejects(productsService.updateVariant('v1', { price: 80 } as never, { canEditPricing: false }), forbidden);
    await assert.rejects(productsService.updateVariant('v1', { stock: 12 } as never, { canEditPricing: false }), (e) => e === SENTINEL);
    // Same price re-sent: not a change.
    await assert.rejects(
      productsService.updateVariant('v1', { stock: 12, price: 100 } as never, { canEditPricing: false }),
      (e) => e !== null && !forbidden(e),
    );
  });
});

describe('the product controller applies the pricing policy to who is asking', () => {
  afterEach(() => {
    mock.restoreAll();
    clearPermissionCache();
  });

  /** What happens when this role sends a price change for a live product of vendor v1: the status code, or 200 when it reached the write. */
  async function priceChangeOutcome(role: string, permissions: string[], body: Record<string, unknown> = { basePrice: 80 }) {
    setPermissionCache(`role-${role}`, permissions);
    mock.method(productsRepository, 'findById', async () => ({ id: 'p1', name: 'Lamp', vendorId: 'v1', status: 'LIVE', listedByPlatform: false, basePrice: '100.00', get: () => ({}) }) as never);
    const update = mock.method(productsService, 'updateProduct', (async () => ({ id: 'p1' })) as never);
    mock.method(AuditLog, 'create', async () => ({ id: 'audit-1' }) as never);
    mock.method(User, 'findAll', async () => [] as never);
    const req = {
      params: { id: 'p1' },
      body,
      user: { id: 'u1', roleId: `role-${role}`, role: { name: role }, vendorId: role.startsWith('VENDOR') ? 'v1' : null },
    } as unknown as Request;
    const res = { json: () => res } as unknown as Response;
    const status = await new Promise<number>((resolve) => {
      void productsController.updateProduct(req, res, (err?: unknown) => resolve((err as { statusCode?: number })?.statusCode ?? 500));
      setTimeout(() => resolve(200), 100);
    });
    return { status, wrote: update.mock.callCount() === 1 };
  }

  const perms = (role: string) => [...ROLE_PERMISSIONS[role]!];

  it('vendor owner: may reprice their own product', async () => assert.deepEqual(await priceChangeOutcome(ROLES.VENDOR_OWNER, perms(ROLES.VENDOR_OWNER)), { status: 200, wrote: true }));
  it('vendor staff: may not', async () => assert.deepEqual(await priceChangeOutcome(ROLES.VENDOR_STAFF, perms(ROLES.VENDOR_STAFF)), { status: 403, wrote: false }));
  it('Catalog Manager: may not reprice a vendor’s live product', async () => assert.deepEqual(await priceChangeOutcome(ROLES.ADMIN_CATALOG_MANAGER, perms(ROLES.ADMIN_CATALOG_MANAGER)), { status: 403, wrote: false }));
  it('Super Admin: needs a written reason, then may', async () => {
    assert.deepEqual(await priceChangeOutcome(ROLES.SUPER_ADMIN, perms(ROLES.SUPER_ADMIN)), { status: 422, wrote: false });
    assert.deepEqual(
      await priceChangeOutcome(ROLES.SUPER_ADMIN, perms(ROLES.SUPER_ADMIN), { basePrice: 80, changeReason: 'Vendor asked us to fix the price' }),
      { status: 200, wrote: true },
    );
  });
  it('a custom role with product.manage and product.pricing may, with a reason; product.pricing alone may not', async () => {
    const reason = { basePrice: 80, changeReason: 'Vendor asked us to fix the price' };
    assert.deepEqual(await priceChangeOutcome('PRICING_DESK', ['product.manage', 'product.pricing'], reason), { status: 200, wrote: true });
    assert.deepEqual(await priceChangeOutcome('PRICING_ONLY', ['product.pricing'], reason), { status: 403, wrote: false });
  });
  it('non-pricing edits stay open to everyone who could edit before', async () => {
    for (const role of [ROLES.VENDOR_OWNER, ROLES.VENDOR_STAFF, ROLES.ADMIN_CATALOG_MANAGER, ROLES.SUPER_ADMIN]) {
      assert.deepEqual(await priceChangeOutcome(role, perms(role), { name: 'x' }), { status: 200, wrote: true }, role);
    }
  });
});
