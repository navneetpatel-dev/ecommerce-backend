import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { preGstCouponBreakdown } from '../couponUsageAmounts';

describe('coupon usage in pre-GST terms', () => {
  const coupons = [
    { id: 'c-flat', code: 'FLAT100' },
    { id: 'c-vendor', code: 'SHOP50' },
    { id: 'c-ship', code: 'FREESHIP' },
  ];

  it("records each coupon's part of the discount the engine applied", () => {
    const breakdown = preGstCouponBreakdown(
      [
        // ₹100 GST-inclusive split over two vendors, and a vendor's own ₹50 on v1.
        { code: 'FLAT100', type: 'FLAT', discount: 100, cashbackAmount: 0, freeShipping: false, vendorShares: { v1: 60, v2: 40 } },
        { code: 'SHOP50', type: 'FLAT', discount: 50, cashbackAmount: 0, freeShipping: false, vendorShares: { v1: 50 } },
        { code: 'FREESHIP', type: 'FREE_SHIPPING', discount: 49, cashbackAmount: 0, freeShipping: true, vendorShares: { v2: 49 } },
      ],
      coupons,
      {
        // v1 at 18%: ₹110 inclusive is ₹93.22 pre-GST; v2 at 5%: ₹40 is ₹38.10.
        v1: { paise: { merchandiseDiscountPaise: 9_322, shippingDiscountPaise: 0 } },
        v2: { paise: { merchandiseDiscountPaise: 3_810, shippingDiscountPaise: 4_900 } },
      },
    );
    const byId = Object.fromEntries(breakdown.map((row) => [row.couponId, row.discountApplied]));
    // v1's ₹93.22 split 60:50 (₹50.85 + ₹42.37), plus all of v2's ₹38.10.
    assert.equal(byId['c-flat'], 88.95);
    assert.equal(byId['c-vendor'], 42.37);
    // Shipping carries no GST split: the free-shipping coupon is what it waived.
    assert.equal(byId['c-ship'], 49);
    // Together they are exactly what the engine took off.
    assert.equal(Math.round((byId['c-flat']! + byId['c-vendor']! + byId['c-ship']!) * 100), 9_322 + 3_810 + 4_900);
  });
});
