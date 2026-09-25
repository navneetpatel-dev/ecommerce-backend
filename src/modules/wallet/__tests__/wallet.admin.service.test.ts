import assert from 'node:assert/strict';
import { describe, it, mock, afterEach } from 'node:test';
import { walletAdminService } from '../wallet.admin.service';
import { walletService } from '../wallet.service';
import { WALLET_POINT_SOURCE } from '@core/constants/statuses';
import { AuditLog } from '@database/models/auditLog.model';

type AuditRow = { actorId: string; action: string; entityId: string; metadata?: Record<string, unknown> };

/** adjustWallet writes an audit row; capture it instead of hitting the database. */
function stubAudit(): AuditRow[] {
  const rows: AuditRow[] = [];
  mock.method(AuditLog, 'create', async (row: AuditRow) => {
    rows.push(row);
    return row as never;
  });
  return rows;
}

describe('WalletAdminService.adjustWallet', () => {
  afterEach(() => mock.restoreAll());

  it('credits promotional points by default', async () => {
    const audit = stubAudit();
    let creditOptions: { pointSource?: string } | undefined;
    mock.method(walletService, 'credit', async (_userId, _amount, _ref, _desc, _txn, options) => {
      creditOptions = options;
      return { id: 'ledger-credit-1' };
    });
    mock.method(walletService, 'getBalance', async () => 150);
    mock.method(walletService, 'getPointSourceBalances', async () => ({
      purchased: 100,
      promotional: 50,
      total: 150,
    }));

    const result = await walletAdminService.adjustWallet('target-user', 'actor-1', {
      direction: 'CREDIT',
      amount: 25,
      reason: 'Goodwill credit',
    });

    assert.equal(result.ledgerId, 'ledger-credit-1');
    assert.equal(result.balance, 150);
    assert.equal(result.purchasedBalance, 100);
    assert.equal(result.promotionalBalance, 50);
    assert.equal(creditOptions?.pointSource, WALLET_POINT_SOURCE.PROMOTIONAL);
    assert.deepEqual(
      audit.map((row) => [row.actorId, row.action, row.entityId, row.metadata?.ledgerId]),
      [['actor-1', 'WALLET_ADMIN_CREDIT', 'target-user', 'ledger-credit-1']],
    );
  });

  it('debits wallet on DEBIT direction', async () => {
    const audit = stubAudit();
    mock.method(walletService, 'debit', async () => ({ id: 'ledger-debit-1' }));
    mock.method(walletService, 'getBalance', async () => 75);
    mock.method(walletService, 'getPointSourceBalances', async () => ({
      purchased: 50,
      promotional: 25,
      total: 75,
    }));

    const result = await walletAdminService.adjustWallet('target-user', 'actor-1', {
      direction: 'DEBIT',
      amount: 10,
      reason: 'Correction debit',
    });

    assert.equal(result.ledgerId, 'ledger-debit-1');
    assert.equal(result.balance, 75);
    assert.equal(audit[0]?.action, 'WALLET_ADMIN_DEBIT');
  });
});
