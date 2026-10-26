import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { sequelize } from '@database/models';
import { Payout } from '@database/models/payout.model';
import { Vendor } from '@database/models/vendor.model';
import { AuditLog } from '@database/models/auditLog.model';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { CommissionInvoice } from '@database/models/commissionInvoice.model';
import { TdsLedger } from '@database/models/tdsLedger.model';
import { User } from '@database/models/user.model';
import { payoutsService } from '../payouts.service';

describe('PayoutsService.markFailed', () => {
  afterEach(() => mock.restoreAll());

  it('puts the payout\'s sales back for the next run and voids its TDS and commission invoices', async () => {
    mock.method(sequelize, 'transaction', async (callback: (t: unknown) => Promise<unknown>) =>
      callback({ LOCK: { UPDATE: 'UPDATE' } }),
    );
    const payout = {
      id: 'payout-1',
      vendorId: 'vendor-1',
      amount: 1000,
      status: 'PENDING',
      update: async function update(this: { status: string }, fields: { status?: string }) {
        if (fields.status) this.status = fields.status;
        return this;
      },
    };
    mock.method(Payout, 'findByPk', async () => payout as never);
    mock.method(Vendor, 'findByPk', async () => ({ businessName: 'Store' }) as never);
    mock.method(User, 'findOne', async () => null);
    mock.method(AuditLog, 'create', async () => ({}) as never);
    const reopened: Array<{ values: Record<string, unknown>; where: Record<string, unknown> }> = [];
    mock.method(CommissionLedger, 'update', async (values: Record<string, unknown>, options: { where: Record<string, unknown> }) => {
      reopened.push({ values, where: options.where });
      return [3] as never;
    });
    const tds = mock.method(TdsLedger, 'destroy', async () => 2);
    const invoices = mock.method(CommissionInvoice, 'destroy', async () => 1);

    await payoutsService.markFailed('payout-1', 'admin-1', { reason: 'Bank rejected the transfer' } as never);

    assert.equal(payout.status, 'FAILED');
    assert.deepEqual(reopened[0]?.where, { payoutId: 'payout-1', status: 'SETTLED' });
    assert.equal(reopened[0]?.values.status, 'PENDING');
    assert.equal(reopened[0]?.values.payoutId, null);
    assert.deepEqual((tds.mock.calls[0]?.arguments[0] as { where: unknown }).where, { payoutId: 'payout-1' });
    assert.deepEqual((invoices.mock.calls[0]?.arguments[0] as { where: unknown }).where, { payoutId: 'payout-1' });
  });
});
