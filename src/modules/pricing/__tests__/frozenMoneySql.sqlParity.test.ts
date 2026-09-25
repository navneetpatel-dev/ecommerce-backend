/**
 * Runs each SQL read helper in Postgres against the same rows its TS twin sees,
 * so the two definitions cannot drift apart. A mismatch is a real finding — do
 * not "fix" the test to match whichever answer came first.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@database/models';
import {
  sqlLineSubtotalPaise,
  sqlVendorNetPayoutPaise,
  vendorNetPayoutPaise,
  type VendorNetPayoutSource,
} from '../frozenMoneySql';
import { lineSubtotal } from '../displayMoney';
import { toPaise } from '../money';

let dbReady = false;

async function dbAvailable(): Promise<boolean> {
  try {
    await Promise.race([
      sequelize.authenticate(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
    ]);
    return true;
  } catch {
    return false;
  }
}

const LEDGER_CASES: Array<VendorNetPayoutSource & { label: string }> = [
  { label: 'frozen paise', netPayoutAmountPaise: 81234, netPayoutAmount: '1.00', saleAmount: '999.00', commissionAmount: '0', tcsAmount: '0' },
  { label: 'frozen rupees', netPayoutAmountPaise: null, netPayoutAmount: '812.34', saleAmount: '999.00', commissionAmount: '0', tcsAmount: '0' },
  { label: 'legacy with TCS', netPayoutAmountPaise: null, netPayoutAmount: null, saleAmount: '1000.00', commissionAmount: '100.00', tcsAmount: '10.00' },
  { label: 'legacy without TCS', netPayoutAmountPaise: null, netPayoutAmount: null, saleAmount: '333.33', commissionAmount: '33.33', tcsAmount: null },
  { label: 'stored zero', netPayoutAmountPaise: 0, netPayoutAmount: '5.00', saleAmount: '5.00', commissionAmount: '0', tcsAmount: '0' },
  { label: 'legacy odd paise', netPayoutAmountPaise: null, netPayoutAmount: null, saleAmount: '0.07', commissionAmount: '0.01', tcsAmount: '0.01' },
];

describe('frozen money SQL ↔ TS parity', () => {
  before(async () => {
    dbReady = await dbAvailable();
  });

  it('sqlVendorNetPayoutPaise matches vendorNetPayoutPaise', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    for (const row of LEDGER_CASES) {
      const [result] = await sequelize.query<{ net: string }>(
        `SELECT ${sqlVendorNetPayoutPaise('cl')} AS net
         FROM (SELECT
           :netPayoutAmountPaise::bigint AS "netPayoutAmountPaise",
           :netPayoutAmount::numeric(12,2) AS "netPayoutAmount",
           :saleAmount::numeric(12,2) AS "saleAmount",
           :commissionAmount::numeric(12,2) AS "commissionAmount",
           :tcsAmount::numeric(12,2) AS "tcsAmount"
         ) cl`,
        {
          replacements: {
            netPayoutAmountPaise: row.netPayoutAmountPaise ?? null,
            netPayoutAmount: row.netPayoutAmount ?? null,
            saleAmount: row.saleAmount ?? null,
            commissionAmount: row.commissionAmount ?? null,
            tcsAmount: row.tcsAmount ?? null,
          },
          type: QueryTypes.SELECT,
        },
      );
      assert.equal(Number(result?.net), vendorNetPayoutPaise(row), row.label);
    }
  });

  it('sqlLineSubtotalPaise matches displayMoney.lineSubtotal', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const cases = [
      { lineSubtotal: null, unitPrice: '199.99', quantity: 3 },
      { lineSubtotal: '120.50', unitPrice: '60.25', quantity: 3 },
      { lineSubtotal: '0.00', unitPrice: '60.25', quantity: 3 },
    ];
    for (const row of cases) {
      const [result] = await sequelize.query<{ paise: string }>(
        `SELECT ${sqlLineSubtotalPaise('oi')} AS paise
         FROM (SELECT
           :lineSubtotal::numeric(12,2) AS "lineSubtotal",
           :unitPrice::numeric(12,2) AS "unitPrice",
           :quantity::int AS "quantity"
         ) oi`,
        { replacements: row, type: QueryTypes.SELECT },
      );
      const expected =
        row.lineSubtotal != null
          ? toPaise(Number(row.lineSubtotal))
          : toPaise(lineSubtotal(row.unitPrice, row.quantity));
      assert.equal(Number(result?.paise), expected, JSON.stringify(row));
    }
  });
});
