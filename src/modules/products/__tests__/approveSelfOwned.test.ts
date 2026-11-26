import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { randomUUID } from 'node:crypto';
import { AuditLog } from '@database/models/auditLog.model';
import { productsRepository } from '../products.repository';
import { productsService } from '../products.service';

const pending = (vendorId: string | null) =>
  ({ id: 'p1', status: 'PENDING_APPROVAL', vendorId, categoryId: null }) as never;

describe('approving a product', () => {
  // The independence check reads the audit trail; these products have no platform history.
  beforeEach(() => mock.method(AuditLog, 'count', async () => 0));
  afterEach(() => mock.restoreAll());

  it('is refused when the approver belongs to the product’s own store', async () => {
    mock.method(productsRepository, 'findById', async () => pending('vendor-1'));
    await assert.rejects(
      productsService.approveProduct(randomUUID(), 'approver-1', 'vendor-1'),
      (e: { statusCode?: number; message?: string }) => e.statusCode === 403 && /your own store/.test(e.message ?? ''),
    );
  });

  it('gets past the self-approval check for an approver with no store (reaches the normal checks)', async () => {
    mock.method(productsRepository, 'findById', async () => pending('vendor-1'));
    await assert.rejects(
      productsService.approveProduct(randomUUID(), 'catalog-manager-1', null),
      (e: { message?: string }) => !/your own store/.test(e.message ?? '') && /variant/i.test(e.message ?? ''),
    );
  });

  it('gets past the check for an approver from a different store', async () => {
    mock.method(productsRepository, 'findById', async () => pending('vendor-1'));
    await assert.rejects(
      productsService.approveProduct(randomUUID(), 'other-1', 'vendor-2'),
      (e: { message?: string }) => !/your own store/.test(e.message ?? '') && /variant/i.test(e.message ?? ''),
    );
  });

  it('the old two-argument call still works (no approver store known)', async () => {
    mock.method(productsRepository, 'findById', async () => pending('vendor-1'));
    await assert.rejects(
      productsService.approveProduct(randomUUID(), 'admin-1'),
      (e: { message?: string }) => /variant/i.test(e.message ?? ''),
    );
  });
});
