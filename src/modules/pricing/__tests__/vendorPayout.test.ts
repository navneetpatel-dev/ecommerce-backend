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
      { netPaise: 107500, tdsBasePaise: 100000, tdsRatePercent: 0.1, tdsPaise: 100 },
      { netPaise: 20001, tdsBasePaise: 20001, tdsRatePercent: 0.1, tdsPaise: 20 },
    ]);
    assert.equal(result.commissionTaxablePaise, 12000);
    assert.equal(result.commissionGstPaise, 2160);
    // (107500 − 100) + (20001 − 20) − 2160
    assert.equal(result.payoutPaise, 125221);
  });

  it('withholds TDS at the rate frozen on each sale, not the current rate', () => {
    const result = vendorPayoutBreakdown(
      [
        // Sold while the rate was 1% (DECIMAL arrives as a string).
        { netPayoutAmountPaise: 107500, commissionAmountPaise: 0, taxableAmountPaise: 100000, tdsRatePercent: '1.000' },
        // Sold after it moved to 0.1%.
        { netPayoutAmountPaise: 107500, commissionAmountPaise: 0, taxableAmountPaise: 100000, tdsRatePercent: 0.1 },
        // No frozen rate: the current platform rate applies.
        { netPayoutAmountPaise: 107500, commissionAmountPaise: 0, taxableAmountPaise: 100000, tdsRatePercent: null },
      ],
      { tdsRatePercent: 0.5, commissionGstRatePercent: 0 },
    );
    assert.deepEqual(
      result.rows.map((row) => [row.tdsRatePercent, row.tdsPaise]),
      [
        [1, 1000],
        [0.1, 100],
        [0.5, 500],
      ],
    );
    assert.equal(result.payoutPaise, 107500 * 3 - 1000 - 100 - 500);
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
      { netPaise: 89000, tdsBasePaise: 89000, tdsRatePercent: 1, tdsPaise: 890 },
      { netPaise: -5000, tdsBasePaise: 0, tdsRatePercent: 0, tdsPaise: 0 },
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

  it('recovers a return after payout, giving back its TDS and the GST on its commission', () => {
    const returned = {
      netPayoutAmountPaise: -40000,
      commissionAmountPaise: -4000,
      taxableAmountPaise: -35001,
      // Withheld at 1% when the sale was paid, though the platform rate is 0.1% now.
      tdsRatePercent: '1.000',
      referenceType: 'ReturnClawback',
    };
    const result = vendorPayoutBreakdown([sale, returned], { ...rates, tdsRatePercent: 0.1 });
    // TDS reversed on ₹350.01 at 1%, rounded like the deduction was: −₹3.50.
    assert.deepEqual(result.rows[1], {
      netPaise: -40000,
      tdsBasePaise: -35001,
      tdsRatePercent: 1,
      tdsPaise: -350,
    });
    // Commission GST on ₹100 − ₹40 of commission.
    assert.equal(result.commissionTaxablePaise, 6000);
    assert.equal(result.commissionGstPaise, 1080);
    // (89000 − 89 TDS at 0.1%) − 1080 − 40000 + 350
    assert.equal(result.payoutPaise, 48181);
  });

  it('gives the commission GST back when returns hand back more commission than sales earn', () => {
    const smallSale = {
      netPayoutAmountPaise: 60000,
      commissionAmountPaise: 1000,
      taxableAmountPaise: 50000,
      referenceType: null,
    };
    const returned = {
      netPayoutAmountPaise: -20000,
      commissionAmountPaise: -3000,
      taxableAmountPaise: -18000,
      tdsRatePercent: 0,
      referenceType: 'ReturnClawback',
    };
    const result = vendorPayoutBreakdown([smallSale, returned], {
      tdsRatePercent: 0,
      commissionGstRatePercent: 18,
    });
    assert.equal(result.commissionTaxablePaise, -2000);
    assert.equal(result.commissionGstPaise, -360);
    // 60000 + ₹3.60 GST back − 20000 returned.
    assert.equal(result.payoutPaise, 40360);
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
    // A negative commission gives the GST back, rounded like a charge.
    assert.equal(commissionGstPaise(-12345, 18), -2222);
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
