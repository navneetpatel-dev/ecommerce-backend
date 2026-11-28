import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import type { Request, Response } from 'express';
import { sequelize } from '@database/models';
import { PRODUCT_STATUS, ROLES } from '@core/constants/statuses';
import { settingsService } from '@modules/settings/settings.service';
import { productsRepository } from '../products.repository';
import { productsService } from '../products.service';
import * as productsController from '../products.controller';
import { CreateProductOnBehalfSchema } from '../products.dto';

const status = (e: unknown) => (e as { statusCode?: number }).statusCode;
const reason = 'Sole admin; vendor confirmed by phone';

describe('products without a vendor are disabled', () => {
  afterEach(() => mock.restoreAll());

  it('cannot be created by the service or asked for through the on-behalf endpoint', async () => {
    await assert.rejects(productsService.createProduct(null, {} as never), (e) => status(e) === 422);
    const product = { name: 'Lamp', categoryId: '11111111-1111-4111-8111-111111111111', description: 'd', basePrice: 10 };
    assert.equal(CreateProductOnBehalfSchema.safeParse({ product }).success, false);
  });

  it('an old vendorless draft cannot be submitted by anyone', async () => {
    mock.method(sequelize, 'transaction', async (callback: (t: object) => Promise<unknown>) => callback({}));
    mock.method(settingsService, 'getPlatformSettings', async () => ({ autoApproveProducts: true }) as never);
    mock.method(productsRepository, 'findById', async () => ({ id: 'p1', vendorId: null, status: PRODUCT_STATUS.DRAFT }) as never);
    const update = mock.method(productsRepository, 'update', async () => undefined as never);
    await assert.rejects(productsService.submitForApproval('p1', null, 'sa-1'), (e) => status(e) === 403);
    assert.equal(update.mock.callCount(), 0);
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
    await call(productsController.approveProduct, ROLES.VENDOR_OWNER, 'v9', { ownWorkReason: reason });
    await call(productsController.approveProduct, ROLES.SUPER_ADMIN, null, {});
    assert.equal(approve.mock.calls[0]!.arguments[3], reason);
    assert.equal(approve.mock.calls[1]!.arguments[3], undefined, 'only the Super Admin can use the override');
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

  it('submit: the caller’s own store is what the service is given, and nothing else', async () => {
    const submit = mock.method(productsService, 'submitForApproval', (async () => ({ id: 'p1' })) as never);
    await call(productsController.submitForApproval, ROLES.SUPER_ADMIN, null);
    await call(productsController.submitForApproval, ROLES.VENDOR_OWNER, 'v1');
    assert.deepEqual(submit.mock.calls[0]!.arguments.slice(1), [null, 'u1']);
    assert.deepEqual(submit.mock.calls[1]!.arguments.slice(1), ['v1', 'u1']);
  });
});
