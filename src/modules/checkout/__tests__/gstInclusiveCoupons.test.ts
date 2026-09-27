import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Vendor } from '@database/models/vendor.model';
import type { PlatformSettingsPayload } from '@modules/settings/settings.service';
import { priceVendorRows, type VendorPricingRow } from '../vendorPricingPlan';

const settings = { defaultCommissionRate: 10, tcsRatePercent: 0 } as PlatformSettingsPayload;

/** One ₹1,000 (pre-GST) item at 18%, shipped inter-state (IGST). */
function row(overrides: Partial<VendorPricingRow> = {}): VendorPricingRow {
  return {
    vendorId: 'v1',
    vendor: { state: 'MAHARASHTRA', commissionRate: 10 } as Vendor,
    lines: [{ key: 'l1', vendorId: 'v1', unitPrice: 1000, quantity: 1, categoryId: 'c1', weightGrams: 500 }],
    shippingCost: 0,
    shippingRateFound: true,
    gstPercentage: 18,
    commissionRatePercent: 10,
    lineRates: { l1: { gstPercentage: 18, gstPriceBand: null, commissionRatePercent: 10 } },
    ...overrides,
  };
}

function price(share: number, vendorBorne = 0) {
  return priceVendorRows({
    rows: [row()],
    shares: {
      vendorDiscountShares: share ? { v1: share } : {},
      vendorShippingDiscountShares: {},
      vendorBorneDiscountShares: vendorBorne ? { v1: vendorBorne } : {},
    },
    shippingStateCode: 'KARNATAKA',
    settings,
  });
}

describe('coupons on GST-inclusive prices', () => {
  it('shows the items at their GST-inclusive price, adding up to what is paid', () => {
    const { pricedByVendor, inclusiveByVendor } = price(0);
    assert.equal(inclusiveByVendor.v1!.itemsPaise, 118_000);
    assert.deepEqual(inclusiveByVendor.v1!.lines.l1, { unitPricePaise: 118_000, lineTotalPaise: 118_000 });
    assert.equal(pricedByVendor.v1!.paise.customerTotalPaise, 118_000);
  });

  it('takes a flat ₹100 coupon off what the customer pays, not off the pre-GST price', () => {
    const { pricedByVendor, inclusiveByVendor } = price(100);
    const p = pricedByVendor.v1!.paise;
    // ₹84.75 off the pre-GST value; GST on the rest: the customer pays ₹1,080.
    assert.equal(p.merchandiseDiscountPaise, 8_475);
    assert.equal(p.customerTotalPaise, 108_000);
    // The bill still shows the item at ₹1,180 before the coupon.
    assert.equal(inclusiveByVendor.v1!.itemsPaise, 118_000);
  });

  it('keeps the vendor-funded share of a converted discount', () => {
    const { pricedByVendor, bearerByVendor } = price(100, 100);
    assert.equal(pricedByVendor.v1!.paise.merchandiseDiscountPaise, 8_475);
    assert.equal(bearerByVendor.v1, 'VENDOR');
    assert.equal(pricedByVendor.v1!.paise.platformFundedDiscountPaise, 0);
  });
});
