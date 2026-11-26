import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { sequelize } from '@database/models';
import { AuditLog } from '@database/models/auditLog.model';
import { ProductCategory } from '@database/models/productCategory.model';
import { ProductImage } from '@database/models/productImage.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { User } from '@database/models/user.model';
import { Vendor } from '@database/models/vendor.model';
import { PRODUCT_STATUS } from '@core/constants/statuses';
import { notificationsService } from '@modules/notifications/notifications.service';
import { settingsService } from '@modules/settings/settings.service';
import { vendorsService } from '@modules/vendors/vendors.service';
import { productsRepository } from '../products.repository';
import { productsService } from '../products.service';
import { createProductOnBehalf, submitProductOnBehalf } from '../productOnBehalf.service';

const VENDOR_ID = '11111111-1111-4111-8111-111111111111';
const status = (e: unknown) => (e as { statusCode?: number }).statusCode;
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('createProductOnBehalf', () => {
  let audits: Array<Record<string, any>>;
  let listed: string[];

  beforeEach(() => {
    audits = [];
    listed = [];
    mock.method(AuditLog, 'create', async (row: Record<string, unknown>) => {
      audits.push(row);
      return { id: 'audit-1' } as never;
    });
    mock.method(User, 'findAll', async () => [{ id: 'vu1' }, { id: 'vu2' }] as never);
    mock.method(notificationsService, 'sendProductListedByPlatform', (async (userId: string) => {
      listed.push(userId);
    }) as never);
  });
  afterEach(() => mock.restoreAll());

  const vendorIs = (vendorStatus: string | null) =>
    mock.method(Vendor, 'findByPk', async () => (vendorStatus ? { id: VENDOR_ID, status: vendorStatus } : null) as never);
  const dto = { vendorId: VENDOR_ID, product: { name: 'Lamp', categoryId: 'c1', basePrice: 100 } } as never;

  it('refuses a vendor that is missing, pending, rejected or suspended, creating nothing', async () => {
    const create = mock.method(productsService, 'createProduct', (async () => ({ id: 'p1', name: 'Lamp' })) as never);
    for (const vendorStatus of [null, 'PENDING', 'REJECTED', 'SUSPENDED']) {
      mock.method(Vendor, 'findByPk', async () => (vendorStatus ? { status: vendorStatus } : null) as never);
      await assert.rejects(createProductOnBehalf('admin-1', dto), (e) => status(e) === 422, String(vendorStatus));
    }
    assert.equal(create.mock.callCount(), 0);
    assert.equal(audits.length, 0);
  });

  it('creates a platform-listed draft for an approved vendor, audits it under that vendor and tells the vendor’s users', async () => {
    vendorIs('APPROVED');
    const create = mock.method(productsService, 'createProduct', (async () => ({ id: 'p1', name: 'Lamp' })) as never);
    const product = await createProductOnBehalf('admin-1', dto);
    await flush();

    assert.equal(product.id, 'p1');
    const [vendorId, , by] = create.mock.calls[0]!.arguments as unknown as [string, unknown, { actorId: string; listedByPlatform: boolean }];
    assert.equal(vendorId, VENDOR_ID);
    assert.deepEqual(by, { actorId: 'admin-1', listedByPlatform: true });
    assert.equal(audits.length, 1);
    assert.equal(audits[0]!.action, 'PRODUCT_CREATED_ON_BEHALF');
    assert.equal(audits[0]!.actorId, 'admin-1');
    assert.equal(audits[0]!.entityId, 'p1');
    assert.equal(audits[0]!.metadata.vendorId, VENDOR_ID, 'the audit page filters a vendor’s history by this');
    assert.deepEqual(listed.sort(), ['vu1', 'vu2']);
  });

  it('a notification failure never undoes the listing', async () => {
    vendorIs('APPROVED');
    mock.method(productsService, 'createProduct', (async () => ({ id: 'p1', name: 'Lamp' })) as never);
    mock.method(User, 'findAll', async () => {
      throw new Error('db down');
    });
    await assert.doesNotReject(createProductOnBehalf('admin-1', dto));
    await flush();
  });
});

describe('submitProductOnBehalf', () => {
  let updates: Array<Record<string, unknown>>;
  let audits: Array<Record<string, any>>;
  let stored: Record<string, unknown>;

  beforeEach(() => {
    updates = [];
    audits = [];
    stored = { id: 'p1', vendorId: VENDOR_ID, status: PRODUCT_STATUS.DRAFT, categoryId: 'c1', name: 'Lamp', listedByPlatform: true };
    mock.method(sequelize, 'transaction', async (callback: (t: object) => Promise<unknown>) => callback({}));
    mock.method(productsRepository, 'findById', async () => stored as never);
    mock.method(ProductVariant, 'count', async () => 1 as never);
    mock.method(ProductImage, 'count', async () => 1 as never);
    mock.method(ProductCategory, 'findAll', async () => [] as never);
    mock.method(vendorsService, 'assertCategoriesKycSatisfied', async () => undefined);
    mock.method(productsRepository, 'update', async (_id: string, fields: Record<string, unknown>) => {
      updates.push(fields);
      return undefined as never;
    });
    mock.method(productsService, 'getProductById', async () => ({ id: 'p1', vendorId: VENDOR_ID, name: 'Lamp' }) as never);
    mock.method(User, 'findAll', async () => [] as never);
    mock.method(AuditLog, 'create', async (row: Record<string, unknown>) => {
      audits.push(row);
      return { id: 'audit-1' } as never;
    });
  });
  afterEach(() => mock.restoreAll());

  const autoApprove = (on: boolean) => mock.method(settingsService, 'getPlatformSettings', async () => ({ autoApproveProducts: on }) as never);
  const note = 'Vendor agreed by phone on 26 Nov, ticket 4521';

  it('queues it for a different admin to approve, records the consent, and audits it', async () => {
    autoApprove(false);
    await submitProductOnBehalf('admin-1', 'p1', note);
    assert.equal(updates[0]?.status, PRODUCT_STATUS.PENDING_APPROVAL);
    assert.equal(updates[0]?.vendorConsentNote, note);
    assert.equal(updates[0]?.updatedBy, 'admin-1');
    assert.equal(audits[0]?.action, 'PRODUCT_SUBMITTED_ON_BEHALF');
    assert.equal(audits[0]?.metadata.vendorId, VENDOR_ID);
    assert.equal(audits[0]?.metadata.consentNote, note);
  });

  it('is never auto-approved, even when the platform setting is on', async () => {
    autoApprove(true);
    await submitProductOnBehalf('admin-1', 'p1', note);
    assert.equal(updates[0]?.status, PRODUCT_STATUS.PENDING_APPROVAL);
    assert.ok(!audits.some((a) => a.action === 'PRODUCT_AUTO_APPROVED'));
  });

  it('a rejected platform listing can be submitted again, clearing the old rejection note', async () => {
    autoApprove(false);
    stored.status = PRODUCT_STATUS.REJECTED;
    await submitProductOnBehalf('admin-1', 'p1', note);
    assert.equal(updates[0]?.status, PRODUCT_STATUS.PENDING_APPROVAL);
    assert.equal(updates[0]?.rejectionNote, null);
  });

  it('refuses a product the vendor made themselves (403) and one that is already pending or live (422)', async () => {
    autoApprove(false);
    stored.listedByPlatform = false;
    await assert.rejects(submitProductOnBehalf('admin-1', 'p1', note), (e) => status(e) === 403);
    stored.listedByPlatform = true;
    for (const s of [PRODUCT_STATUS.PENDING_APPROVAL, PRODUCT_STATUS.LIVE, PRODUCT_STATUS.ARCHIVED]) {
      stored.status = s;
      await assert.rejects(submitProductOnBehalf('admin-1', 'p1', note), (e) => status(e) === 422, s);
    }
    assert.equal(updates.length, 0);
    assert.equal(audits.length, 0);
  });

  it('still requires a variant, an image and approved KYC categories', async () => {
    autoApprove(false);
    mock.method(ProductVariant, 'count', async () => 0 as never);
    await assert.rejects(submitProductOnBehalf('admin-1', 'p1', note), (e) => /variant/i.test((e as Error).message));
    mock.method(ProductVariant, 'count', async () => 1 as never);
    mock.method(ProductImage, 'count', async () => 0 as never);
    await assert.rejects(submitProductOnBehalf('admin-1', 'p1', note), (e) => /image/i.test((e as Error).message));
    assert.equal(updates.length, 0);
  });

  it('a missing product is a 404', async () => {
    mock.method(productsRepository, 'findById', async () => null as never);
    await assert.rejects(submitProductOnBehalf('admin-1', 'nope', note), (e) => status(e) === 404);
  });

  it('the vendor’s own submit is unchanged: still their store only, still honours auto-approve', async () => {
    autoApprove(true);
    await assert.rejects(productsService.submitForApproval('p1', 'other-vendor', 'u1'), (e) => status(e) === 403);
    await productsService.submitForApproval('p1', VENDOR_ID, 'u1');
    assert.equal(updates[0]?.status, PRODUCT_STATUS.LIVE);
  });
});
