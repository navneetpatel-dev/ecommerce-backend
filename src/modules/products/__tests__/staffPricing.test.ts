import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { ProductVariant } from '@database/models/productVariant.model';
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

describe('the product controller grants pricing rights to exactly owners and platform product admins', () => {
  afterEach(() => {
    mock.restoreAll();
    clearPermissionCache();
  });

  async function pricingRightsFor(role: string, permissions: string[]) {
    setPermissionCache(`role-${role}`, permissions);
    const update = mock.method(productsService, 'updateProduct', (async () => ({ id: 'p1' })) as never);
    const req = {
      params: { id: 'p1' },
      body: { name: 'x' },
      user: { id: 'u1', roleId: `role-${role}`, role: { name: role }, vendorId: role.startsWith('VENDOR') ? 'v1' : null },
    } as unknown as Request;
    const res = { json: () => res } as unknown as Response;
    await new Promise<void>((resolve, reject) => {
      void productsController.updateProduct(req, res, (err?: unknown) => (err ? reject(err) : resolve()));
      setTimeout(resolve, 50);
    });
    return (update.mock.calls[0]!.arguments[3] as { canEditPricing: boolean }).canEditPricing;
  }

  it('vendor owner: yes', async () => assert.equal(await pricingRightsFor(ROLES.VENDOR_OWNER, [...ROLE_PERMISSIONS[ROLES.VENDOR_OWNER]!]), true));
  it('vendor staff: no', async () => assert.equal(await pricingRightsFor(ROLES.VENDOR_STAFF, [...ROLE_PERMISSIONS[ROLES.VENDOR_STAFF]!]), false));
  it('Catalog Manager (product.manage): yes', async () => assert.equal(await pricingRightsFor(ROLES.ADMIN_CATALOG_MANAGER, [...ROLE_PERMISSIONS[ROLES.ADMIN_CATALOG_MANAGER]!]), true));
  it('Super Admin: yes', async () => assert.equal(await pricingRightsFor(ROLES.SUPER_ADMIN, [...ROLE_PERMISSIONS[ROLES.SUPER_ADMIN]!]), true));
});
