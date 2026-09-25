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
import { fromPaise, toPaise } from '../money';

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
  { label: 'frozen paise', netPayoutAmountPaise: 81234 },
  { label: 'stored zero', netPayoutAmountPaise: 0 },
  { label: 'return clawback', netPayoutAmountPaise: -500 },
  { label: 'BIGINT string', netPayoutAmountPaise: '20001' },
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
         FROM (SELECT :netPayoutAmountPaise::bigint AS "netPayoutAmountPaise") cl`,
        {
          replacements: { netPayoutAmountPaise: row.netPayoutAmountPaise },
          type: QueryTypes.SELECT,
        },
      );
      assert.equal(Number(result?.net), vendorNetPayoutPaise(row), row.label);
    }
  });

  it('sqlLineSubtotalPaise matches displayMoney.lineSubtotal', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const cases = [
      { lineSubtotal: null, unitPricePaise: 19999, quantity: 3 },
      { lineSubtotal: '120.50', unitPricePaise: 6025, quantity: 3 },
      { lineSubtotal: '0.00', unitPricePaise: 6025, quantity: 3 },
    ];
    for (const row of cases) {
      const [result] = await sequelize.query<{ paise: string }>(
        `SELECT ${sqlLineSubtotalPaise('oi')} AS paise
         FROM (SELECT
           :lineSubtotal::numeric(12,2) AS "lineSubtotal",
           :unitPricePaise::bigint AS "unitPricePaise",
           :quantity::int AS "quantity"
         ) oi`,
        { replacements: row, type: QueryTypes.SELECT },
      );
      const expected =
        row.lineSubtotal != null
          ? toPaise(Number(row.lineSubtotal))
          : toPaise(lineSubtotal(fromPaise(row.unitPricePaise), row.quantity));
      assert.equal(Number(result?.paise), expected, JSON.stringify(row));
    }
  });
});
