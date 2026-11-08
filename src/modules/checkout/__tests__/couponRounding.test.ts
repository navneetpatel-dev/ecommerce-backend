import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Vendor } from '@database/models/vendor.model';
import type { PlatformSettingsPayload } from '@modules/settings/settings.service';
import { priceVendorRows, type VendorPricingRow } from '../vendorPricingPlan';
import { actualCouponSavingsPaise, withActualLineShares, withActualSavings } from '../actualCouponSavings';

const settings = { defaultCommissionRate: 10, tcsRatePercent: 0 } as PlatformSettingsPayload;

type Line = { key: string; variantId: string; unitPrice: number; gst: number };

/** Items from one Maharashtra vendor; KARNATAKA ships inter-state (IGST), MAHARASHTRA intra (CGST+SGST). */
function row(lines: Line[]): VendorPricingRow {
  return {
    vendorId: 'v1',
    vendor: { state: 'MAHARASHTRA', commissionRate: 10 } as Vendor,
    lines: lines.map((line) => ({
      key: line.key,
      variantId: line.variantId,
      vendorId: 'v1',
      unitPrice: line.unitPrice,
      quantity: 1,
      categoryId: 'c1',
      weightGrams: 500,
    })),
    shippingCost: 0,
    shippingRateFound: true,
    gstPercentage: 18,
    commissionRatePercent: 10,
    lineRates: Object.fromEntries(
      lines.map((line) => [line.key, { gstPercentage: line.gst, gstPriceBand: null, commissionRatePercent: 10 }]),
    ),
  };
}

/** Prices the lines with a GST-inclusive coupon share promised to each line (paise). */
function price(lines: Line[], promised: Record<string, number>, state = 'KARNATAKA') {
  const total = Object.values(promised).reduce((sum, value) => sum + value, 0);
  return priceVendorRows({
    rows: [row(lines)],
    shares: {
      vendorDiscountShares: { v1: total / 100 },
      vendorShippingDiscountShares: {},
      vendorBorneDiscountShares: {},
      lineDiscountShares: Object.fromEntries(
        Object.entries(promised).map(([variantId, paise]) => [variantId, { discountPaise: paise, vendorBornePaise: 0 }]),
      ),
    },
    shippingStateCode: state,
    settings,
  });
}

const item = (key: string, unitPrice: number, gst = 18): Line => ({ key, variantId: `var-${key}`, unitPrice, gst });

describe('U9: a coupon never takes off less than advertised', () => {
  it('₹120 off a ₹1,180 item shipped inter-state: at least ₹120.00 (₹119.99 before)', () => {
    const { pricedByVendor, actualLineDiscountPaise } = price([item('a', 1000)], { 'var-a': 12_000 });
    const paid = pricedByVendor.v1!.paise.customerTotalPaise;
    assert.ok(118_000 - paid >= 12_000, `saved ${118_000 - paid}`);
    assert.ok(118_000 - paid <= 12_001, 'at most a paisa more');
    assert.equal(actualLineDiscountPaise['var-a'], 118_000 - paid);
  });

  it('₹120 off the same item within the state comes off exactly', () => {
    const { pricedByVendor } = price([item('a', 1000)], { 'var-a': 12_000 }, 'MAHARASHTRA');
    assert.equal(118_000 - pricedByVendor.v1!.paise.customerTotalPaise, 12_000);
  });

  it('a ₹100 bundle across an 18% and a 12% item takes off at least ₹100.00', () => {
    // ₹1,180 and ₹527.82-ish items: shares promised as the engine splits them.
    const { pricedByVendor } = price(
      [item('a', 1000), item('b', 471.27, 12)],
      { 'var-a': 6_782, 'var-b': 3_218 },
    );
    const gross = 118_000 + Math.round(47_127 * 1.12);
    const saved = gross - pricedByVendor.v1!.paise.customerTotalPaise;
    assert.ok(saved >= 10_000 && saved <= 10_002, `saved ${saved}`);
  });

  it('never discounts a line past its own value', () => {
    const { pricedByVendor } = price([item('a', 1)], { 'var-a': 118 });
    assert.ok(pricedByVendor.v1!.paise.customerTotalPaise >= 0);
    assert.ok(pricedByVendor.v1!.paise.merchandiseDiscountPaise <= 100);
  });

  it('the chip shows what the coupon really took off, split by share on a shared line', () => {
    const coupons = [
      { code: 'A', discount: 60, lineShares: { v: 6_000 } },
      { code: 'B', discount: 60, lineShares: { v: 6_000 } },
      { code: 'SHIP', discount: 40 },
    ];
    const savings = actualCouponSavingsPaise(coupons, { v: 12_001 });
    assert.equal((savings.get('A') ?? 0) + (savings.get('B') ?? 0), 12_001);
    assert.equal(savings.get('SHIP'), 4_000);
    const shown = withActualSavings(coupons, { v: 12_001 });
    assert.equal(shown.some((coupon) => 'lineShares' in coupon), false);
  });
});

describe('U22: returns hold back what each line really gave', () => {
  it('the snapshot line takes its share of the real saving', () => {
    const [snapshot] = withActualLineShares(
      [{ lines: [{ variantId: 'v', discountPaise: 6_782 }] }],
      { v: { discountPaise: 6_782 } },
      { v: 6_783 },
    );
    assert.equal(snapshot!.lines[0]!.discountPaise, 6_783);
  });

  it('a line shared with a coupon outside the snapshot keeps only its own share', () => {
    const [snapshot] = withActualLineShares(
      [{ lines: [{ variantId: 'v', discountPaise: 5_000 }] }],
      { v: { discountPaise: 10_000 } },
      { v: 10_002 },
    );
    assert.equal(snapshot!.lines[0]!.discountPaise, 5_001);
  });
});
