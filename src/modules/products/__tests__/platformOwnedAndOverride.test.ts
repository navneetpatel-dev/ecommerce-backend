import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import type { Request, Response } from 'express';
import { sequelize } from '@database/models';
import { AuditLog } from '@database/models/auditLog.model';
import { ProductCategory } from '@database/models/productCategory.model';
import { ProductImage } from '@database/models/productImage.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { User } from '@database/models/user.model';
import { PRODUCT_STATUS, ROLES } from '@core/constants/statuses';
import { vendorsService } from '@modules/vendors/vendors.service';
import { productsRepository } from '../products.repository';
import { productsService } from '../products.service';
import { createProductOnBehalf } from '../productOnBehalf.service';
import * as productsController from '../products.controller';
import { CreateProductOnBehalfSchema } from '../products.dto';

const status = (e: unknown) => (e as { statusCode?: number }).statusCode;
const reason = 'Sole admin; vendor confirmed by phone';

describe('the platform’s own products (no vendor)', () => {
  let updates: Array<Record<string, unknown>>;
  let audits: Array<Record<string, any>>;
  let stored: Record<string, unknown>;
  let kyc: ReturnType<typeof mock.method>;
  let users: ReturnType<typeof mock.method>;

  beforeEach(() => {
    updates = [];
    audits = [];
    stored = { id: 'p1', vendorId: null, status: PRODUCT_STATUS.DRAFT, categoryId: 'c1', name: 'House brand lamp' };
    mock.method(sequelize, 'transaction', async (callback: (t: object) => Promise<unknown>) => callback({}));
    mock.method(productsRepository, 'findById', async () => stored as never);
    mock.method(ProductVariant, 'count', async () => 1 as never);
    mock.method(ProductImage, 'count', async () => 1 as never);
    mock.method(ProductCategory, 'findAll', async () => [] as never);
    kyc = mock.method(vendorsService, 'assertCategoriesKycSatisfied', async () => undefined);
    mock.method(productsRepository, 'update', async (_id: string, fields: Record<string, unknown>) => {
      updates.push(fields);
      return undefined as never;
    });
    mock.method(productsService, 'getProductById', async () => ({ id: 'p1', name: 'House brand lamp' }) as never);
    users = mock.method(User, 'findAll', async () => [] as never);
    mock.method(AuditLog, 'create', async (row: Record<string, unknown>) => {
      audits.push(row);
      return { id: 'a1' } as never;
    });
  });
  afterEach(() => mock.restoreAll());

  it('a Super Admin publishing one goes live at once, approved by them, audited, with no KYC check and no vendor emails', async () => {
    await productsService.submitForApproval('p1', null, 'sa-1', true);
    assert.equal(updates[0]?.status, PRODUCT_STATUS.LIVE);
    assert.equal(updates[0]?.approvedById, 'sa-1');
    assert.equal(audits[0]?.action, 'PRODUCT_AUTO_APPROVED');
    assert.equal(audits[0]?.metadata.platformOwned, true);
    assert.equal(kyc.mock.callCount(), 0);
    assert.equal(users.mock.callCount(), 0, 'no vendor, so nobody to email (and never a lookup by a null vendor)');
  });

  it('still needs a variant and an image', async () => {
    mock.method(ProductVariant, 'count', async () => 0 as never);
    await assert.rejects(productsService.submitForApproval('p1', null, 'sa-1', true), (e) => /variant/i.test((e as Error).message));
    assert.equal(updates.length, 0);
  });

  it('a vendor’s product cannot be published this way (403), and a non-draft is refused (422)', async () => {
    stored.vendorId = 'v1';
    await assert.rejects(productsService.submitForApproval('p1', null, 'sa-1', true), (e) => status(e) === 403);
    stored.vendorId = null;
    stored.status = PRODUCT_STATUS.LIVE;
    await assert.rejects(productsService.submitForApproval('p1', null, 'sa-1', true), (e) => status(e) === 422);
  });

  describe('creating one', () => {
    const dto = CreateProductOnBehalfSchema.parse({ product: { name: 'Lamp', categoryId: '11111111-1111-4111-8111-111111111111', description: 'd', basePrice: 10 } });

    it('only a Super Admin may leave the vendor out; it is created with no vendor and audited', async () => {
      const create = mock.method(productsService, 'createProduct', (async () => ({ id: 'p9', name: 'Lamp' })) as never);
      await assert.rejects(createProductOnBehalf('cm-1', dto, false), (e) => status(e) === 403);
      assert.equal(create.mock.callCount(), 0);
      await createProductOnBehalf('sa-1', dto, true);
      assert.deepEqual(create.mock.calls[0]!.arguments.slice(0, 1), [null]);
      assert.equal(audits[0]?.action, 'PRODUCT_CREATED_BY_PLATFORM');
    });
  });
});

describe('the approve and publish endpoints, by who is asking', () => {
  afterEach(() => mock.restoreAll());

  async function call(handler: (req: Request, res: Response, next: (e?: unknown) => void) => void, role: string, vendorId: string | null, body: unknown = {}) {
    const req = { params: { id: 'p1' }, body, user: { id: 'u1', role: { name: role }, vendorId } } as unknown as Request;
    const res = { json: () => res } as unknown as Response;
    await new Promise<void>((resolve) => {
      void handler(req, res, () => resolve());
      setTimeout(resolve, 50);
    });
  }

  it('approve: the own-work reason reaches the service only for a Super Admin', async () => {
    const approve = mock.method(productsService, 'approveProduct', (async () => ({ id: 'p1' })) as never);
    await call(productsController.approveProduct, ROLES.SUPER_ADMIN, null, { ownWorkReason: reason });
    await call(productsController.approveProduct, ROLES.ADMIN_CATALOG_MANAGER, null, { ownWorkReason: reason });
    await call(productsController.approveProduct, ROLES.SUPER_ADMIN, null, {});
    assert.equal(approve.mock.calls[0]!.arguments[3], reason);
    assert.equal(approve.mock.calls[1]!.arguments[3], undefined, 'Catalog Manager cannot use the override');
    assert.equal(approve.mock.calls[2]!.arguments[3], undefined);
  });

  it('approve: a too-short reason is rejected before the service is called', async () => {
    const approve = mock.method(productsService, 'approveProduct', (async () => ({})) as never);
    let error: unknown;
    const req = { params: { id: 'p1' }, body: { ownWorkReason: 'short' }, user: { id: 'u1', role: { name: ROLES.SUPER_ADMIN }, vendorId: null } } as unknown as Request;
    await new Promise<void>((resolve) => {
      void productsController.approveProduct(req, {} as Response, (e?: unknown) => {
        error = e;
        resolve();
      });
      setTimeout(resolve, 50);
    });
    assert.ok(error);
    assert.equal(approve.mock.callCount(), 0);
  });

  it('submit: with no store, only a Super Admin publishes directly; a vendor owner submits as before', async () => {
    const submit = mock.method(productsService, 'submitForApproval', (async () => ({ id: 'p1' })) as never);
    await call(productsController.submitForApproval, ROLES.SUPER_ADMIN, null);
    await call(productsController.submitForApproval, ROLES.ADMIN_CATALOG_MANAGER, null);
    await call(productsController.submitForApproval, ROLES.VENDOR_OWNER, 'v1');
    assert.equal(submit.mock.calls[0]!.arguments[3], true);
    assert.equal(submit.mock.calls[1]!.arguments[3], false);
    assert.deepEqual(submit.mock.calls[2]!.arguments.slice(1, 2), ['v1']);
    assert.equal(submit.mock.calls[2]!.arguments[3], false);
  });
});
