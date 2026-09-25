import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toPaise } from '@modules/pricing/money';
import { walletRechargeGstSplit } from '../walletRechargeInvoice.service';

describe('walletRechargeGstSplit', () => {
  it('splits odd-paise tax so the invoice adds up to the amount paid', () => {
    // ₹100 at 18%: taxable ₹84.75, tax ₹15.25 → ₹7.62 + ₹7.63 (was ₹7.63 + ₹7.63).
    assert.deepEqual(walletRechargeGstSplit(100, 18), {
      taxableAmount: 84.75,
      cgst: 7.62,
      sgst: 7.63,
      igst: 0,
    });
  });

  it('always sums to the recharge amount', () => {
    for (const amount of [1, 99.99, 100, 250.5, 1999, '4999.00']) {
      for (const rate of [5, 12, 18, 28]) {
        const split = walletRechargeGstSplit(amount, rate);
        assert.equal(
          toPaise(split.taxableAmount) + toPaise(split.cgst) + toPaise(split.sgst),
          toPaise(Number(amount)),
          `${amount} @ ${rate}%`,
        );
      }
    }
  });

  it('charges no tax when the rate is 0', () => {
    assert.deepEqual(walletRechargeGstSplit(500, 0), {
      taxableAmount: 500,
      cgst: 0,
      sgst: 0,
      igst: 0,
    });
  });
});
