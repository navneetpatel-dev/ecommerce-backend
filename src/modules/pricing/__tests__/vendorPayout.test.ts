import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  commissionGstPaise,
  payoutRatesFromSettings,
  vendorPayoutBreakdown,
} from '../vendorPayout';

describe('vendorPayoutBreakdown', () => {
  const ledgers = [
    // ₹1,000 sale + ₹180 GST: ₹100 commission, ₹5 TCS → ₹1,075 net.
    { netPayoutAmountPaise: '107500', commissionAmountPaise: '10000', taxableAmountPaise: '100000' },
    { netPayoutAmountPaise: 20001, commissionAmountPaise: 2000, taxableAmountPaise: 20001 },
  ];

  it('deducts 194-O TDS on the sale value excluding GST, and GST on the commission', () => {
    const result = vendorPayoutBreakdown(ledgers, { tdsRatePercent: 0.1, commissionGstRatePercent: 18 });
    // TDS is on the taxable ₹1,000, not the ₹1,075 net (which includes GST).
    assert.deepEqual(result.rows, [
      { netPaise: 107500, tdsBasePaise: 100000, tdsPaise: 100 },
      { netPaise: 20001, tdsBasePaise: 20001, tdsPaise: 20 },
    ]);
    assert.equal(result.commissionTaxablePaise, 12000);
    assert.equal(result.commissionGstPaise, 2160);
    // (107500 − 100) + (20001 − 20) − 2160
    assert.equal(result.payoutPaise, 125221);
  });

  it('is the plain net when there is no TDS or GST', () => {
    const result = vendorPayoutBreakdown(ledgers, { tdsRatePercent: 0, commissionGstRatePercent: 0 });
    assert.equal(result.payoutPaise, 127501);
  });

  it('never pays a negative amount', () => {
    const result = vendorPayoutBreakdown(
      [{ netPayoutAmountPaise: 100, commissionAmountPaise: 100000, taxableAmountPaise: 100 }],
      { tdsRatePercent: 0, commissionGstRatePercent: 18 },
    );
    assert.equal(result.payoutPaise, 0);
  });
});

describe('vendorPayoutBreakdown with vendor-borne cashback', () => {
  const rates = { tdsRatePercent: 1, commissionGstRatePercent: 18 };
  const sale = {
    netPayoutAmountPaise: 89000,
    commissionAmountPaise: 10000,
    taxableAmountPaise: 89000,
    referenceType: null,
  };
  const cost = { netPayoutAmountPaise: -5000, commissionAmountPaise: -5000, referenceType: 'CashbackCost' };
  const reversal = {
    netPayoutAmountPaise: 5000,
    commissionAmountPaise: 5000,
    referenceType: 'CashbackCostReversal',
  };

  it('deducts the cost after TDS and GST, which it is outside of', () => {
    const result = vendorPayoutBreakdown([sale, cost], rates);
    assert.deepEqual(result.rows, [
      { netPaise: 89000, tdsBasePaise: 89000, tdsPaise: 890 },
      { netPaise: -5000, tdsBasePaise: 0, tdsPaise: 0 },
    ]);
    // Commission GST is on the sale's ₹100 commission only.
    assert.equal(result.commissionTaxablePaise, 10000);
    assert.equal(result.commissionGstPaise, 1800);
    // (89000 − 890) − 1800 − 5000
    assert.equal(result.balancePaise, 81310);
    assert.equal(result.payoutPaise, 81310);
  });

  it('nets a reversal against its cost', () => {
    const withBoth = vendorPayoutBreakdown([sale, cost, reversal], rates);
    const saleOnly = vendorPayoutBreakdown([sale], rates);
    assert.equal(withBoth.payoutPaise, saleOnly.payoutPaise);
  });

  it('pays back a reversal on its own', () => {
    const result = vendorPayoutBreakdown([reversal], rates);
    assert.equal(result.commissionGstPaise, 0);
    assert.equal(result.payoutPaise, 5000);
  });

  it('goes negative when the cost exceeds the sales, and pays nothing', () => {
    const result = vendorPayoutBreakdown(
      [
        { netPayoutAmountPaise: 3000, commissionAmountPaise: 0, taxableAmountPaise: 3000, referenceType: null },
        cost,
      ],
      { tdsRatePercent: 0, commissionGstRatePercent: 18 },
    );
    assert.equal(result.balancePaise, -2000);
    assert.equal(result.payoutPaise, 0);
  });
});

describe('commissionGstPaise', () => {
  it('rounds GST on commission in paise and is zero for no commission', () => {
    assert.equal(commissionGstPaise(12345, 18), 2222);
    assert.equal(commissionGstPaise(0, 18), 0);
    assert.equal(commissionGstPaise(-500, 18), 0);
  });
});

describe('payoutRatesFromSettings', () => {
  it('reads TDS and commission GST rates, defaulting GST to 18%', () => {
    assert.deepEqual(payoutRatesFromSettings({ tdsRatePercent: '1' }), {
      tdsRatePercent: 1,
      commissionGstRatePercent: 18,
    });
  });
});
