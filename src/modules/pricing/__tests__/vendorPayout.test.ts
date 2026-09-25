import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  commissionGstPaise,
  payoutRatesFromSettings,
  vendorPayoutBreakdown,
} from '../vendorPayout';

describe('vendorPayoutBreakdown', () => {
  const ledgers = [
    // ₹1,000 sale: ₹100 commission, ₹10 TCS → ₹890 net.
    { netPayoutAmountPaise: '89000', commissionAmountPaise: '10000' },
    { netPayoutAmountPaise: 20001, commissionAmountPaise: 2000 },
  ];

  it('deducts 194-O TDS per ledger and GST on the commission from the net', () => {
    const result = vendorPayoutBreakdown(ledgers, { tdsRatePercent: 1, commissionGstRatePercent: 18 });
    assert.deepEqual(result.rows, [
      { netPaise: 89000, tdsPaise: 890 },
      { netPaise: 20001, tdsPaise: 200 },
    ]);
    assert.equal(result.commissionTaxablePaise, 12000);
    assert.equal(result.commissionGstPaise, 2160);
    // (89000 − 890) + (20001 − 200) − 2160
    assert.equal(result.payoutPaise, 105751);
  });

  it('is the plain net when there is no TDS or GST', () => {
    const result = vendorPayoutBreakdown(ledgers, { tdsRatePercent: 0, commissionGstRatePercent: 0 });
    assert.equal(result.payoutPaise, 109001);
  });

  it('never pays a negative amount', () => {
    const result = vendorPayoutBreakdown(
      [{ netPayoutAmountPaise: 100, commissionAmountPaise: 100000 }],
      { tdsRatePercent: 0, commissionGstRatePercent: 18 },
    );
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
