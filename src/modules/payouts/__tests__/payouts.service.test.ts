import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Op } from 'sequelize';
import { sequelize } from '@database/models';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { Payout } from '@database/models/payout.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Vendor } from '@database/models/vendor.model';
import { User } from '@database/models/user.model';
import { Role } from '@database/models/role.model';
import { settingsService } from '@modules/settings/settings.service';
import { payoutsService } from '../payouts.service';
import { ORDER_STATUS, RETURN_STATUS } from '@core/constants/statuses';

describe('PayoutsService.process return-window and dispute hold', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  function subOrderInclude(options: { include?: unknown }) {
    const include = options.include as Array<{
      model: unknown;
      where?: Record<string, unknown>;
      include?: unknown[];
    }>;
    return include.find((inc) => inc.model === SubOrder);
  }

  function literalSql(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && 'val' in value) {
      return String((value as { val: unknown }).val);
    }
    return JSON.stringify(value);
  }

  function filterSql(options: { include?: unknown }): string {
    const sub = subOrderInclude(options);
    const and = sub?.where?.[Op.and] as unknown[] | undefined;
    return literalSql(and?.[0] ?? sub?.where);
  }

  it('applies a 7-day deliveredAt cutoff and open-return exclusion on the candidate scan', async () => {
    const calls: Array<{ include?: unknown }> = [];
    mock.method(settingsService, 'getPlatformSettings', async () => ({
      tdsRatePercent: 1,
      defaultReturnWindow: 7,
    }));
    mock.method(CommissionLedger, 'findAll', async (options: { include?: unknown }) => {
      calls.push(options);
      return [];
    });

    await payoutsService.process('actor-1');

    assert.equal(calls.length, 1);
    const sub = subOrderInclude(calls[0]!);
    assert.ok(sub);
    assert.equal(sub.where?.status, ORDER_STATUS.DELIVERED);

    const shipment = (sub.include ?? []).find((inc) => (inc as { as?: string }).as === 'shipment') as {
      required?: boolean;
      where?: { deliveredAt?: { [Op.lte]?: Date; [Op.ne]?: null } };
    };
    assert.equal(shipment?.required, true);
    const cutoff = shipment?.where?.deliveredAt?.[Op.lte];
    assert.ok(cutoff instanceof Date);
    const expected = Date.now() - 7 * 24 * 60 * 60 * 1000;
    assert.ok(Math.abs(cutoff.getTime() - expected) < 5_000);

    const sql = filterSql(calls[0]!);
    assert.match(sql, new RegExp(`'${RETURN_STATUS.APPROVED}'`));
    assert.match(sql, new RegExp(`'${RETURN_STATUS.REQUESTED}'`));
    assert.match(sql, new RegExp(`'${RETURN_STATUS.PICKUP_SCHEDULED}'`));
    assert.match(sql, new RegExp(`'${RETURN_STATUS.RECEIVED}'`));
    assert.equal(sql.includes(`'${RETURN_STATUS.CLOSED}'`), false);
    assert.equal(sql.includes(`'${RETURN_STATUS.REFUNDED}'`), false);
  });

  it('uses the same eligibility include on the locked in-transaction query', async () => {
    const calls: Array<{ include?: unknown; lock?: unknown }> = [];
    mock.method(settingsService, 'getPlatformSettings', async () => ({
      tdsRatePercent: 1,
      defaultReturnWindow: 7,
    }));
    mock.method(CommissionLedger, 'findAll', async (options: { include?: unknown; lock?: unknown }) => {
      calls.push(options);
      if (calls.length === 1) {
        return [
          {
            id: 'cl-1',
            vendorId: 'vendor-1',
            createdAt: new Date(),
            netPayoutAmountPaise: 10000,
            commissionAmountPaise: 1000,
          },
        ] as never;
      }
      return [];
    });
    mock.method(sequelize, 'transaction', async (callback: (t: { LOCK: { UPDATE: string } }) => Promise<unknown>) => {
      return callback({ LOCK: { UPDATE: 'UPDATE' } });
    });
    mock.method(Payout, 'create', async (fields: { id?: string; status?: string; amount?: number }) => ({
      id: 'payout-fail',
      amount: fields.amount ?? 100,
      ...fields,
    }) as never);
    mock.method(Vendor, 'findByPk', async () => ({ businessName: 'Store' }) as never);
    mock.method(User, 'findOne', async () => null);
    mock.method(Role, 'findOne', async () => null);

    await payoutsService.process('actor-1');

    assert.ok(calls.length >= 2);
    assert.equal(filterSql(calls[0]!), filterSql(calls[1]!));
    assert.ok(calls[1]?.lock);
    const scanSub = subOrderInclude(calls[0]!);
    const lockedSub = subOrderInclude(calls[1]!);
    assert.deepEqual(scanSub?.include, lockedSub?.include);
    assert.equal(scanSub?.where?.status, ORDER_STATUS.DELIVERED);
  });

  it('sums the frozen paise net payout of every ledger in the batch', async () => {
    const created: Array<{ status?: string; amount?: number }> = [];
    mock.method(settingsService, 'getPlatformSettings', async () => ({
      tdsRatePercent: 0,
      defaultReturnWindow: 7,
    }));
    let scans = 0;
    mock.method(CommissionLedger, 'findAll', async () => {
      scans += 1;
      if (scans > 1) return [];
      return [
        {
          id: 'cl-a',
          vendorId: 'vendor-1',
          createdAt: new Date(),
          netPayoutAmountPaise: '89000',
          commissionAmountPaise: '10000',
        },
        {
          id: 'cl-b',
          vendorId: 'vendor-1',
          createdAt: new Date(),
          netPayoutAmountPaise: 20001,
          commissionAmountPaise: 0,
        },
      ] as never;
    });
    mock.method(sequelize, 'transaction', async (callback: (t: { LOCK: { UPDATE: string } }) => Promise<unknown>) => {
      return callback({ LOCK: { UPDATE: 'UPDATE' } });
    });
    mock.method(Payout, 'create', async (fields: { status?: string; amount?: number }) => {
      created.push(fields);
      return { id: 'payout-fail', ...fields } as never;
    });
    mock.method(Vendor, 'findByPk', async () => ({ businessName: 'Store' }) as never);
    mock.method(User, 'findOne', async () => null);
    mock.method(Role, 'findOne', async () => null);

    await payoutsService.process('actor-1');

    // The locked re-read finds nothing, so the batch is recorded as FAILED with the
    // scanned group total: 890.00 + 200.01, summed in paise (BIGINT arrives as a string).
    assert.equal(created.length, 1);
    assert.equal(created[0]?.amount, 1090.01);
  });

  it('carries ledgers forward when vendor-borne cashback cost exceeds the sales', async () => {
    mock.method(settingsService, 'getPlatformSettings', async () => ({
      tdsRatePercent: 0,
      commissionGstRatePercent: 18,
      defaultReturnWindow: 7,
    }));
    const rows = [
      {
        id: 'cl-sale',
        vendorId: 'vendor-1',
        subOrderId: 'so-1',
        createdAt: new Date(),
        netPayoutAmountPaise: 3000,
        commissionAmountPaise: 0,
        referenceType: null,
      },
      {
        id: 'cl-cost',
        vendorId: 'vendor-1',
        subOrderId: 'so-1',
        createdAt: new Date(),
        netPayoutAmountPaise: -5000,
        commissionAmountPaise: -5000,
        referenceType: 'CashbackCost',
      },
    ];
    mock.method(CommissionLedger, 'findAll', async () => rows as never);
    const settled = mock.method(CommissionLedger, 'update', async () => [0] as never);
    mock.method(sequelize, 'transaction', async (callback: (t: { LOCK: { UPDATE: string } }) => Promise<unknown>) => {
      return callback({ LOCK: { UPDATE: 'UPDATE' } });
    });
    const payouts = mock.method(Payout, 'create', async () => ({ id: 'payout-x' }) as never);

    const created = await payoutsService.process('actor-1');

    // ₹30 of sales less ₹50 of cashback cost: no payout (not even a FAILED one), and
    // both ledgers stay PENDING so the cost nets against the next sales.
    assert.deepEqual(created, []);
    assert.equal(payouts.mock.callCount(), 0);
    assert.equal(settled.mock.callCount(), 0);
  });
});
