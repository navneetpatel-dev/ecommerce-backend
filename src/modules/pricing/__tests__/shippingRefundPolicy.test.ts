import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveShippingRefundPolicy } from '../shippingRefundPolicy';
import { reverseFrozenLine, type PricingLineBreakdown } from '../pricing.engine';
import { RETURN_REASON } from '@core/constants/statuses';

const sampleLine = (): PricingLineBreakdown => ({
  key: 'line-1',
  quantity: 1,
  unitPricePaise: 10000,
  lineSubtotalPaise: 10000,
  discountPaise: 0,
  taxablePaise: 10000,
  tax: { cgst: 900, sgst: 900, igst: 0, total: 1800, gstPercentage: 18 },
  commissionBasePaise: 10000,
  commissionPaise: 1000,
  tcsPaise: 100,
  netPayoutPaise: 8900,
});

describe('resolveShippingRefundPolicy', () => {
  it('refunds shipping for seller-fault reasons', () => {
    assert.deepEqual(resolveShippingRefundPolicy(RETURN_REASON.DAMAGED), {
      refundOriginalShipping: true,
      deductReturnShippingFee: false,
    });
    assert.equal(
      resolveShippingRefundPolicy(RETURN_REASON.WRONG_ITEM).refundOriginalShipping,
      true,
    );
  });

  it('does not refund shipping for customer-fault reasons', () => {
    assert.deepEqual(resolveShippingRefundPolicy(RETURN_REASON.NO_LONGER_NEEDED), {
      refundOriginalShipping: false,
      deductReturnShippingFee: true,
    });
  });
});

describe('reverseFrozenLine shipping policy', () => {
  it('includes shipping for DAMAGED and excludes fee', () => {
    const result = reverseFrozenLine({
      line: sampleLine(),
      returnQuantity: 1,
      reasonCode: RETURN_REASON.DAMAGED,
      shippingChargedPaise: 4900,
      returnShippingFeePaise: 5000,
    });
    assert.equal(result.shippingRefundPaise, 4900);
    assert.equal(result.returnShippingFeePaise, 0);
    assert.equal(result.customerRefundPaise, 10000 + 1800 + 4900);
  });

  it('excludes shipping and deducts fee for NO_LONGER_NEEDED', () => {
    const result = reverseFrozenLine({
      line: sampleLine(),
      returnQuantity: 1,
      reasonCode: RETURN_REASON.NO_LONGER_NEEDED,
      shippingChargedPaise: 4900,
      returnShippingFeePaise: 5000,
    });
    assert.equal(result.shippingRefundPaise, 0);
    assert.equal(result.returnShippingFeePaise, 5000);
    assert.equal(result.customerRefundPaise, 10000 + 1800 - 5000);
  });

  it('charges the return fee once per part', () => {
    const result = reverseFrozenLine({
      line: sampleLine(),
      returnQuantity: 1,
      reasonCode: RETURN_REASON.NO_LONGER_NEEDED,
      shippingChargedPaise: 4900,
      returnShippingFeePaise: 5000,
      returnFeeAlreadyCharged: true,
    });
    assert.equal(result.returnShippingFeePaise, 0);
    assert.equal(result.customerRefundPaise, 10000 + 1800);
  });

  it('refunds shipping pro-rata on a seller-fault partial return, the rest with the last', () => {
    // The part holds ₹400 of goods; this ₹100 line is a quarter of it.
    const first = reverseFrozenLine({
      line: sampleLine(),
      returnQuantity: 1,
      reasonCode: RETURN_REASON.DAMAGED,
      shippingChargedPaise: 4900,
      standingTaxablePaise: 40000,
    });
    assert.equal(first.shippingRefundPaise, 1225);
    assert.equal(first.customerRefundPaise, 10000 + 1800 + 1225);

    // A later return takes the remaining ₹300: it refunds the shipping not yet refunded.
    const last = reverseFrozenLine({
      line: { ...sampleLine(), quantity: 3, lineSubtotalPaise: 30000, taxablePaise: 30000 },
      returnQuantity: 3,
      reasonCode: RETURN_REASON.WRONG_ITEM,
      shippingChargedPaise: 4900,
      shippingRefundedPaise: first.shippingRefundPaise,
      standingTaxablePaise: 30000,
    });
    assert.equal(last.shippingRefundPaise, 4900 - 1225);
  });

  it('refunds no shipping once all of it was refunded', () => {
    const result = reverseFrozenLine({
      line: sampleLine(),
      returnQuantity: 1,
      reasonCode: RETURN_REASON.DAMAGED,
      shippingChargedPaise: 4900,
      shippingRefundedPaise: 4900,
      standingTaxablePaise: 10000,
    });
    assert.equal(result.shippingRefundPaise, 0);
  });
});
