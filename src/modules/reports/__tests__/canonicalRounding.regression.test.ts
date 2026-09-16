import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { roundMoney } from '@modules/pricing/money';

/** Pre-step-09 inline rounding, kept only to prove the helper substitution is a no-op. */
function legacyRound2(value: unknown): number {
  return Math.round(Number(value) * 100) / 100;
}

describe('canonical rounding adoption regression lock', () => {
  const samples = [0, 0.1, 0.105, 1.005, 10.125, 99.999, 100.004, 1234.567, '12.345', null, undefined];

  it('roundMoney matches Math.round(x*100)/100 for wallet-liability field samples', () => {
    const totals = {
      totalLiability: 1234.567,
      totalPointsLiability: 99.999,
      purchasedPointsLiability: 40.25,
      promotionalPointsLiability: 10.125,
    };
    assert.equal(roundMoney(totals.totalLiability), legacyRound2(totals.totalLiability));
    assert.equal(roundMoney(totals.totalPointsLiability), legacyRound2(totals.totalPointsLiability));
    assert.equal(roundMoney(totals.purchasedPointsLiability), legacyRound2(totals.purchasedPointsLiability));
    assert.equal(roundMoney(totals.promotionalPointsLiability), legacyRound2(totals.promotionalPointsLiability));
    assert.deepEqual(
      {
        totalLiability: roundMoney(totals.totalLiability),
        totalPointsLiability: roundMoney(totals.totalPointsLiability),
        purchasedPointsLiability: roundMoney(totals.purchasedPointsLiability),
        promotionalPointsLiability: roundMoney(totals.promotionalPointsLiability),
      },
      {
        totalLiability: 1234.57,
        totalPointsLiability: 100,
        purchasedPointsLiability: 40.25,
        promotionalPointsLiability: 10.13,
      },
    );
  });

  it('roundMoney matches recoveredTotal/writtenOffTotal legacy rounding', () => {
    const aggregate = { recoveredTotal: '12.345', writtenOffTotal: 8.25 };
    assert.equal(roundMoney(aggregate.recoveredTotal), 12.35);
    assert.equal(roundMoney(aggregate.writtenOffTotal), 8.25);
    assert.equal(roundMoney(aggregate.recoveredTotal), legacyRound2(aggregate.recoveredTotal));
    assert.equal(roundMoney(aggregate.writtenOffTotal), legacyRound2(aggregate.writtenOffTotal));
  });

  it('roundMoney matches the legacy AOV formula', () => {
    const cases = [
      { gmv: 1000, orderCount: 3 },
      { gmv: 1999.99, orderCount: 7 },
      { gmv: 0, orderCount: 5 },
      { gmv: 500, orderCount: 0 },
    ];
    for (const c of cases) {
      const oldAov = c.orderCount > 0 ? Math.round((c.gmv / c.orderCount) * 100) / 100 : 0;
      const newAov = c.orderCount > 0 ? roundMoney(c.gmv / c.orderCount) : 0;
      assert.equal(newAov, oldAov);
    }
  });

  it('roundMoney is identity-equal to the inline formula across mixed samples', () => {
    for (const sample of samples) {
      if (sample == null) {
        assert.equal(roundMoney(sample), 0);
        continue;
      }
      assert.equal(roundMoney(sample), legacyRound2(sample));
    }
  });
});
