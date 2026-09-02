import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCheckoutOrderTotals,
  resolveShippingDisplayKey,
  resolveTaxDisplayKey,
  resolveVendorIdForShippingRates,
} from '../checkoutOrderTotals';

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
    assert.equal(totals.shippingDisplayKey, 'PAID');
    assert.equal(totals.taxTotal, 189);
    assert.equal(totals.discountTotal, 10);
    assert.equal(totals.taxDisplayKey, 'GST');
  });

  it('rounds each aggregate so many-vendor float drift cannot leak out', () => {
    // 0.1 + 0.2 style drift: three vendors whose raw sum is 30.599999999999998.
    const vendor = {
      subtotal: 10.2,
      shippingCost: 3.1,
      tax: { cgst: 0.1, sgst: 0.2, igst: 0, total: 0.3 },
      discount: 1.1,
    };
    const totals = buildCheckoutOrderTotals([vendor, vendor, vendor]);

    assert.equal(totals.merchandiseSubtotal, 30.6);
    assert.equal(totals.shippingTotal, 9.3);
    assert.equal(totals.cgst, 0.3);
    assert.equal(totals.sgst, 0.6);
    assert.equal(totals.taxTotal, 0.9);
    assert.equal(totals.discountTotal, 3.3);
  });
});

describe('resolveTaxDisplayKey', () => {
  it('returns IGST when only igst is present', () => {
    assert.equal(
      resolveTaxDisplayKey({ cgst: 0, sgst: 0, igst: 18 }),
      'IGST',
    );
  });

  it('returns GST when igst and cgst/sgst are both present', () => {
    assert.equal(
      resolveTaxDisplayKey({ cgst: 45, sgst: 45, igst: 99 }),
      'GST',
    );
  });

  it('returns CGST_SGST when only intrastate tax is present', () => {
    assert.equal(
      resolveTaxDisplayKey({ cgst: 45, sgst: 45, igst: 0 }),
      'CGST_SGST',
    );
  });
});

describe('resolveShippingDisplayKey', () => {
  it('returns FREE when shipping is zero', () => {
    assert.equal(resolveShippingDisplayKey(0), 'FREE');
  });

  it('returns PAID when shipping is positive', () => {
    assert.equal(resolveShippingDisplayKey(50), 'PAID');
  });
});

describe('resolveVendorIdForShippingRates', () => {
  it('maps platform vendor to null for rate scoping', () => {
    assert.equal(resolveVendorIdForShippingRates('platform'), null);
  });

  it('passes through real vendor ids for rate scoping', () => {
    const vendorId = '11111111-1111-1111-1111-111111111111';
    assert.equal(resolveVendorIdForShippingRates(vendorId), vendorId);
  });
});
