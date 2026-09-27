import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tds194cForPayout, tds194cRate } from '../tds194c';

const limits = { singleThresholdPaise: 3_000_000, annualThresholdPaise: 10_000_000 };

describe('TDS u/s 194C on agent payouts', () => {
  it('deducts nothing while a payout and the year stay within the limits', () => {
    assert.equal(
      tds194cForPayout({ grossPaise: 2_000_000, financialYearGrossPaise: 5_000_000, financialYearTdsPaise: 0, ratePercent: 1, ...limits }),
      0,
    );
  });

  it('deducts on a single payout above ₹30,000', () => {
    // ₹35,000 at 1%: ₹350.
    assert.equal(
      tds194cForPayout({ grossPaise: 3_500_000, financialYearGrossPaise: 0, financialYearTdsPaise: 0, ratePercent: 1, ...limits }),
      35_000,
    );
  });

  it('catches up the whole year once it passes ₹1,00,000', () => {
    // ₹90,000 paid earlier untaxed, ₹20,000 now: 1% of ₹1,10,000 is ₹1,100, all on this payout.
    assert.equal(
      tds194cForPayout({ grossPaise: 2_000_000, financialYearGrossPaise: 9_000_000, financialYearTdsPaise: 0, ratePercent: 1, ...limits }),
      110_000,
    );
    // Later in the year only this payout's own share is left.
    assert.equal(
      tds194cForPayout({ grossPaise: 1_000_000, financialYearGrossPaise: 11_000_000, financialYearTdsPaise: 110_000, ratePercent: 1, ...limits }),
      10_000,
    );
  });

  it('never deducts more than the payout', () => {
    assert.equal(
      tds194cForPayout({ grossPaise: 100_000, financialYearGrossPaise: 20_000_000, financialYearTdsPaise: 0, ratePercent: 20, ...limits }),
      100_000,
    );
  });

  it('uses the PAN rate, or s.206AA without a PAN', () => {
    const settings = { deliveryAgentTdsRatePercent: 1, deliveryAgentTdsNoPanRatePercent: 20 };
    assert.equal(tds194cRate('ABCDE1234F', settings), 1);
    assert.equal(tds194cRate(undefined, settings), 20);
    assert.equal(tds194cRate('not-a-pan', settings), 20);
  });
});
