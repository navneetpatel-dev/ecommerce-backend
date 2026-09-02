import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCheckoutOrderTotals } from '../checkoutOrderTotals';

describe('buildCheckoutOrderTotals', () => {
  it('aggregates vendor breakdown amounts on the server', () => {
    const totals = buildCheckoutOrderTotals([
      {
        subtotal: 1000,
        shippingCost: 0,
        tax: { cgst: 45, sgst: 45, igst: 0, total: 90 },
        discount: 0,
      },
      {
        subtotal: 500,
        shippingCost: 50,
        tax: { cgst: 0, sgst: 0, igst: 99, total: 99 },
        discount: 10,
      },
    ]);

    assert.equal(totals.merchandiseSubtotal, 1500);
    assert.equal(totals.shippingTotal, 50);
    assert.equal(totals.taxTotal, 189);
    assert.equal(totals.discountTotal, 10);
    assert.equal(totals.taxDisplayKey, 'CGST_SGST');
  });
});
