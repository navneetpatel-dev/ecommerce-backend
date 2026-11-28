import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { AuditLog } from '@database/models/auditLog.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { User } from '@database/models/user.model';
import { Vendor } from '@database/models/vendor.model';
import { sequelize } from '@config/db';
import { notificationsService } from '@modules/notifications/notifications.service';
import { productsRepository } from '../products.repository';
import { productsService } from '../products.service';
import { addVariantAs, updateProductAs, updateVariantAs } from '../productAdminChanges';
import type { ProductActor } from '../productChangePolicy';

const actor = (over: Partial<ProductActor>): ProductActor => ({ id: 'u1', vendorId: null, canManage: false, canCreate: false, canPrice: false, ...over });
const owner = actor({ id: 'owner-1', vendorId: 'v1', canCreate: true });
const staff = actor({ id: 'staff-1', vendorId: 'v1' });
const catalogManager = actor({ id: 'cm-1', canManage: true, canCreate: true });
const superAdmin = actor({ id: 'sa-1', canManage: true, canCreate: true, canPrice: true });

const status = (e: unknown) => (e as { statusCode?: number }).statusCode;
const flush = () => new Promise((resolve) => setImmediate(resolve));
const reason = 'Vendor asked us to correct the price';

describe('edits through the admin change layer', () => {
  let stored: Record<string, any>;
  let audits: Array<Record<string, any>>;
  let emails: Array<{ userId: string; changeId: string; data: Record<string, unknown> }>;
  let updateCalls: Array<unknown[]>;

  beforeEach(() => {
    stored = {
      id: 'p1', name: 'Lamp', vendorId: 'v1', status: 'LIVE', listedByPlatform: false,
      basePrice: '100.00', compareAtPrice: null, hsnCode: '9405', codEnabled: true, description: 'Old',
    };
    stored.get = () => ({ ...stored });
    audits = [];
    emails = [];
    updateCalls = [];
    mock.method(productsRepository, 'findById', async () => stored as never);
    mock.method(productsService, 'updateProduct', (async (...args: unknown[]) => {
      updateCalls.push(args);
      return { id: 'p1' };
    }) as never);
    mock.method(AuditLog, 'create', async (row: Record<string, unknown>) => {
      audits.push(row);
      return { id: `audit-${audits.length}` } as never;
    });
    mock.method(User, 'findAll', async () => [{ id: 'vu1' }] as never);
    // The admin notice about a vendor's live edit: no vendor row, no reviewers, nothing queued.
    mock.method(Vendor, 'findByPk', async () => null as never);
    mock.method(sequelize, 'query', async () => [] as never);
    mock.method(notificationsService, 'sendProductUpdatedByPlatform', (async (userId: string, changeId: string, data: Record<string, unknown>) => {
      emails.push({ userId, changeId, data });
    }) as never);
  });
  afterEach(() => mock.restoreAll());

  describe('updateProductAs', () => {
    it('a content edit by the Catalog Manager is allowed, audited under the vendor, and told to the vendor', async () => {
      await updateProductAs(catalogManager, 'p1', { description: 'New text' } as never);
      await flush();
      assert.equal(audits.length, 1);
      assert.equal(audits[0]!.action, 'PRODUCT_UPDATED_ON_BEHALF');
      assert.equal(audits[0]!.actorId, 'cm-1');
      assert.equal(audits[0]!.metadata.vendorId, 'v1');
      assert.deepEqual(audits[0]!.metadata.changedFields, ['description']);
      assert.equal(emails.length, 1);
      assert.match(emails[0]!.changeId, /^p1:\d{4}-\d{2}-\d{2}$/, 'content edits are bundled per product per day');
      assert.equal(emails[0]!.data.changes, 'description');
      assert.equal((updateCalls[0]![3] as { actorId: string }).actorId, 'cm-1', 'updatedBy is recorded');
    });

    it('a form re-sending unchanged values changes nothing, so records nothing', async () => {
      await updateProductAs(catalogManager, 'p1', { description: 'Old', basePrice: 100, codEnabled: true } as never);
      assert.equal(audits.length, 0);
      assert.equal(emails.length, 0);
    });

    it('repricing a live product: the Catalog Manager is refused (403), nothing is written', async () => {
      await assert.rejects(updateProductAs(catalogManager, 'p1', { basePrice: 80, changeReason: reason } as never), (e) => status(e) === 403);
      assert.equal(updateCalls.length, 0);
      assert.equal(audits.length, 0);
    });

    it('repricing a live product: Super Admin must give a reason (422), then it is audited with before/after and the reason, and every such change notifies', async () => {
      await assert.rejects(updateProductAs(superAdmin, 'p1', { basePrice: 80 } as never), (e) => status(e) === 422);
      await updateProductAs(superAdmin, 'p1', { basePrice: 80, changeReason: reason } as never);
      await flush();
      assert.equal(audits[0]!.action, 'PRODUCT_PRICING_CHANGED_ON_BEHALF');
      assert.deepEqual(audits[0]!.metadata.before, { basePrice: '100.00' });
      assert.deepEqual(audits[0]!.metadata.after, { basePrice: 80 });
      assert.equal(audits[0]!.metadata.reason, reason);
      assert.equal(emails[0]!.changeId, 'audit-1', 'one email per audited pricing change');
      assert.equal(emails[0]!.data.reason, `Reason: ${reason}`);
      const sent = updateCalls[0]![2] as Record<string, unknown>;
      assert.equal('changeReason' in sent, false, 'the reason is not stored on the product row');
    });

    it('a platform-listed draft can be priced freely by the Catalog Manager (still audited)', async () => {
      Object.assign(stored, { status: 'DRAFT', listedByPlatform: true });
      await updateProductAs(catalogManager, 'p1', { basePrice: 80 } as never);
      assert.equal(updateCalls.length, 1);
      assert.equal(audits[0]!.action, 'PRODUCT_PRICING_CHANGED_ON_BEHALF');
    });

    it('vendor owner: free to price, nothing audited as on behalf, no email; staff: pricing refused, other edits fine', async () => {
      await updateProductAs(owner, 'p1', { basePrice: 80 } as never);
      assert.equal(audits.length, 0);
      assert.equal(emails.length, 0);
      await assert.rejects(updateProductAs(staff, 'p1', { basePrice: 70 } as never), (e) => status(e) === 403);
      await updateProductAs(staff, 'p1', { description: 'Staff edit' } as never);
      await flush();
      assert.equal(updateCalls.length, 2);
      // New text on a live listing is recorded as the vendor's own edit; the vendor is not emailed.
      assert.deepEqual(audits.map((row) => row.action), ['PRODUCT_LIVE_EDITED_BY_VENDOR']);
      assert.equal(emails.length, 0);
    });

    it('the platform’s own product (no vendor) is edited without any vendor audit or email', async () => {
      stored.vendorId = null;
      await updateProductAs(catalogManager, 'p1', { basePrice: 80 } as never);
      assert.equal(updateCalls.length, 1);
      assert.equal(audits.length, 0);
    });

    it('a missing product is a 404', async () => {
      mock.method(productsRepository, 'findById', async () => null as never);
      await assert.rejects(updateProductAs(catalogManager, 'nope', {} as never), (e) => status(e) === 404);
    });
  });

  describe('variants', () => {
    it('adding a variant is a pricing change: refused for the Catalog Manager on a live product, reason needed from Super Admin', async () => {
      const add = mock.method(productsService, 'addVariant', (async () => ({ id: 'var1' })) as never);
      const variant = { sku: 'S1', price: 90, stock: 5 } as never;
      await assert.rejects(addVariantAs(catalogManager, 'p1', variant), (e) => status(e) === 403);
      await assert.rejects(addVariantAs(superAdmin, 'p1', variant), (e) => status(e) === 422);
      assert.equal(add.mock.callCount(), 0);
      await addVariantAs(superAdmin, 'p1', { ...(variant as object), changeReason: reason } as never);
      await flush();
      assert.equal(audits[0]!.action, 'PRODUCT_VARIANT_ADDED_ON_BEHALF');
      assert.equal(audits[0]!.metadata.sku, 'S1');
      assert.equal(audits[0]!.metadata.vendorId, 'v1');
    });

    it('the Catalog Manager prepares variants on a platform-listed draft freely', async () => {
      Object.assign(stored, { status: 'DRAFT', listedByPlatform: true });
      mock.method(productsService, 'addVariant', (async () => ({ id: 'var1' })) as never);
      await addVariantAs(catalogManager, 'p1', { sku: 'S1', price: 90 } as never);
      assert.equal(audits[0]!.action, 'PRODUCT_VARIANT_ADDED_ON_BEHALF');
    });

    it('vendor staff may not add a variant (unchanged)', async () => {
      await assert.rejects(addVariantAs(staff, 'p1', { sku: 'S1', price: 90 } as never), (e) => status(e) === 403);
    });

    it('a stock change is content; a price change is pricing (before/after audited)', async () => {
      mock.method(ProductVariant, 'findByPk', async () => ({ id: 'var1', productId: 'p1', sku: 'S1', price: '90.00', stock: 5, get: () => ({ price: '90.00', stock: 5 }) }) as never);
      const update = mock.method(productsService, 'updateVariant', (async () => ({ id: 'var1' })) as never);
      await updateVariantAs(catalogManager, 'var1', { stock: 20 } as never);
      assert.equal(audits[0]!.action, 'PRODUCT_VARIANT_UPDATED_ON_BEHALF');
      assert.deepEqual(audits[0]!.metadata.changedFields, ['variant stock']);
      await assert.rejects(updateVariantAs(catalogManager, 'var1', { price: 70 } as never), (e) => status(e) === 403);
      await updateVariantAs(superAdmin, 'var1', { price: 70, changeReason: reason } as never);
      assert.deepEqual(audits[1]!.metadata.before, { price: '90.00' });
      assert.deepEqual(audits[1]!.metadata.after, { price: 70 });
      assert.equal(audits[1]!.metadata.reason, reason);
      assert.equal(update.mock.callCount(), 2);
    });
  });
});
