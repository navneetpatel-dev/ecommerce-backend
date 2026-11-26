import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { AuditLog } from '@database/models/auditLog.model';
import { assertApproverIndependent } from '../productApprovalRules';
import { ON_BEHALF_ACTIONS } from '../productChangeAudit';

const refused = (e: unknown) => (e as { statusCode?: number; message?: string }).statusCode === 403 && /created, edited or submitted/.test((e as Error).message);

describe('maker-checker: whoever prepared a platform listing cannot approve it', () => {
  afterEach(() => mock.restoreAll());

  it('refuses the admin who created it', async () => {
    const count = mock.method(AuditLog, 'count', async () => 0);
    await assert.rejects(assertApproverIndependent({ id: 'p1', createdBy: 'admin-1', listedByPlatform: true }, 'admin-1'), refused);
    assert.equal(count.mock.callCount(), 0, 'decided from the product itself');
  });

  it('refuses an admin who edited, priced or submitted it (found in the audit trail)', async () => {
    const count = mock.method(AuditLog, 'count', async () => 2);
    await assert.rejects(assertApproverIndependent({ id: 'p1', createdBy: 'admin-1', listedByPlatform: true }, 'admin-2'), refused);
    const where = (count.mock.calls[0]!.arguments[0] as { where: Record<string, unknown> }).where;
    assert.equal(where.entityType, 'Product');
    assert.equal(where.entityId, 'p1');
    assert.equal(where.actorId, 'admin-2');
    const actions = (Object.getOwnPropertySymbols(where.action as object).map((s) => (where.action as Record<symbol, unknown>)[s])[0]) as string[];
    assert.deepEqual([...actions].sort(), [...ON_BEHALF_ACTIONS].sort());
  });

  it('lets an independent admin approve', async () => {
    mock.method(AuditLog, 'count', async () => 0);
    await assert.doesNotReject(assertApproverIndependent({ id: 'p1', createdBy: 'admin-1', listedByPlatform: true }, 'admin-2'));
  });

  it('does not touch products a vendor made (no platform history, creator is the vendor’s user)', async () => {
    mock.method(AuditLog, 'count', async () => 0);
    await assert.doesNotReject(assertApproverIndependent({ id: 'p2', createdBy: 'vendor-user', listedByPlatform: false }, 'admin-1'));
    await assert.doesNotReject(assertApproverIndependent({ id: 'p3', createdBy: null, listedByPlatform: false }, 'admin-1'));
  });

  it('a Super Admin may approve their own work by giving a written reason; the override is reported so it can be audited', async () => {
    mock.method(AuditLog, 'count', async () => 3);
    const product = { id: 'p1', createdBy: 'sa-1', listedByPlatform: true };
    assert.equal(await assertApproverIndependent(product, 'sa-1', 'Sole admin; vendor confirmed by phone'), true);
    for (const reason of [undefined, '', 'short', '   short   ']) {
      await assert.rejects(assertApproverIndependent(product, 'sa-1', reason), refused, String(reason));
    }
  });

  it('an independent approver is not an override, even if a reason is sent', async () => {
    mock.method(AuditLog, 'count', async () => 0);
    assert.equal(await assertApproverIndependent({ id: 'p1', createdBy: 'admin-1', listedByPlatform: true }, 'admin-2', 'unneeded reason here'), false);
  });
});
