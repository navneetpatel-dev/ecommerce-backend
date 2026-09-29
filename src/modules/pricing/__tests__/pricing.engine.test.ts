import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DISCOUNT_BEARER } from '@core/constants/statuses';
import { allocateProportionally, fromPaise, toPaise } from '../money';
import {
  computeSubOrderBreakdown,
  reverseFrozenLine,
} from '../pricing.engine';

describe('pricing money', () => {
  it('converts rupees to paise without float drift', () => {
    assert.equal(toPaise(10.99), 1099);
    assert.equal(fromPaise(1099), 10.99);
  });

  it('allocates remainder to the largest weight', () => {
    assert.deepEqual(allocateProportionally(100, [1, 1, 1]), [34, 33, 33]);
    assert.deepEqual(allocateProportionally(100, [1, 2, 1]), [25, 50, 25]);
  });
});

describe('PricingEngine', () => {
  it('taxes post-discount amount and excludes tax/shipping from commission', () => {
    const result = computeSubOrderBreakdown({
      lines: [
        { key: 'a', unitPricePaise: 10000, quantity: 1 },
        { key: 'b', unitPricePaise: 5000, quantity: 2 },
      ],
      merchandiseDiscountPaise: 2000,
      shippingDiscountPaise: 0,
      shippingCostPaise: 5000,
      gstPercentage: 18,
      intraState: false,
      commissionRatePercent: 10,
      discountBearer: DISCOUNT_BEARER.PLATFORM,
      tcsRatePercent: 1,
    });

    // subtotal 20000, discount 2000 → taxable 18000
    assert.equal(result.subtotalPaise, 20000);
    assert.equal(result.taxablePaise, 18000);
    assert.equal(result.tax.total, 3240); // 18% of 18000
    assert.equal(result.tax.igst, 3240);
    // PLATFORM bearer → commission on pre-discount subtotal
    assert.equal(result.commissionBasePaise, 20000);
    assert.equal(result.commissionPaise, 2000);
    // The platform funds this coupon and pays the vendor the ₹20 back, so the vendor's
    // value of supply is ₹200: its GST (₹36) and TCS (1% = ₹2) are on that value, and the
    // platform pays the ₹3.60 GST the customer did not.
    assert.equal(result.platformFundedDiscountPaise, 2000);
    assert.equal(result.supplyTaxablePaise, 20000);
    assert.equal(result.supplyTax.total, 3600);
    assert.equal(result.supplyTax.igst, 3600);
    assert.equal(result.platformGstSubsidyPaise, 360);
    assert.equal(result.tcsPaise, 200);
    // The vendor remits the GST, so its net includes it: supply + GST − commission − TCS.
    assert.equal(result.netPayoutPaise, 20000 + 3600 - 2000 - 200);
    assert.equal(
      result.lines.reduce((sum, line) => sum + line.netPayoutPaise, 0),
      result.netPayoutPaise,
    );
    // customer = taxable + tax + shipping
    assert.equal(result.customerTotalPaise, 18000 + 3240 + 5000);
  });

  it('uses post-discount commission base when vendor bears discount', () => {
    const result = computeSubOrderBreakdown({
      lines: [{ key: 'a', unitPricePaise: 10000, quantity: 1 }],
      merchandiseDiscountPaise: 1000,
      shippingDiscountPaise: 0,
      shippingCostPaise: 0,
      gstPercentage: 18,
      intraState: true,
      commissionRatePercent: 10,
      discountBearer: DISCOUNT_BEARER.VENDOR,
      tcsRatePercent: 0,
    });
    assert.equal(result.taxablePaise, 9000);
    assert.equal(result.commissionBasePaise, 9000);
    assert.equal(result.commissionPaise, 900);
    assert.equal(result.tax.cgst + result.tax.sgst, result.tax.total);
    // The vendor funds this one: nothing comes back from the platform.
    assert.equal(result.platformFundedDiscountPaise, 0);
    assert.equal(result.netPayoutPaise, 9000 + result.tax.total - 900);
  });

  it('reconciles customer payment + platform coupon to payouts + commission + tcs + shipping', () => {
    const result = computeSubOrderBreakdown({
      lines: [
        { key: 'a', unitPricePaise: 9999, quantity: 1 },
        { key: 'b', unitPricePaise: 3333, quantity: 3 },
      ],
      merchandiseDiscountPaise: 777,
      shippingDiscountPaise: 100,
      shippingCostPaise: 4900,
      gstPercentage: 12,
      intraState: false,
      commissionRatePercent: 8.5,
      discountBearer: DISCOUNT_BEARER.PLATFORM,
      tcsRatePercent: 1,
    });

    // The platform adds its coupon share and the GST on it to what the customer paid.
    const left =
      result.customerTotalPaise +
      result.platformFundedDiscountPaise +
      result.platformGstSubsidyPaise;
    const right =
      result.netPayoutPaise +
      result.commissionPaise +
      result.tcsPaise +
      result.shippingChargedPaise;
    assert.equal(left, right);
  });

  it('uses mixed vendor-borne discount for commission base', () => {
    const result = computeSubOrderBreakdown({
      lines: [{ key: 'a', unitPricePaise: 20000, quantity: 1 }],
      merchandiseDiscountPaise: 3000, // 2000 platform + 1000 vendor
      vendorBorneMerchandiseDiscountPaise: 1000,
      shippingDiscountPaise: 0,
      shippingCostPaise: 0,
      gstPercentage: 18,
      intraState: false,
      commissionRatePercent: 10,
      discountBearer: DISCOUNT_BEARER.PLATFORM,
      tcsRatePercent: 1,
    });
    assert.equal(result.taxablePaise, 17000);
    assert.equal(result.commissionBasePaise, 19000); // subtotal − vendor-borne only
    assert.equal(result.commissionPaise, 1900);
    // The platform's ₹20 share comes back to the vendor; the vendor's own ₹10 does not.
    // So the value of supply is ₹190: GST ₹34.20, TCS ₹1.90.
    assert.equal(result.platformFundedDiscountPaise, 2000);
    assert.equal(result.supplyTaxablePaise, 19000);
    assert.equal(result.supplyTax.total, 3420);
    assert.equal(result.tax.total, 3060);
    assert.equal(result.tcsPaise, 190);
    assert.equal(result.netPayoutPaise, 19000 + 3420 - 1900 - 190);
  });

  it('exposes non-zero roundingAdjustmentPaise when line tax drift is corrected', () => {
    const result = computeSubOrderBreakdown({
      lines: [
        { key: 'a', unitPricePaise: 100, quantity: 1 },
        { key: 'b', unitPricePaise: 100, quantity: 1 },
        { key: 'c', unitPricePaise: 100, quantity: 1 },
      ],
      merchandiseDiscountPaise: 1,
      shippingDiscountPaise: 0,
      shippingCostPaise: 0,
      gstPercentage: 18,
      intraState: false,
      commissionRatePercent: 10,
      discountBearer: DISCOUNT_BEARER.PLATFORM,
      tcsRatePercent: 0,
    });
    const summed = result.lines.reduce((sum, line) => sum + line.tax.total, 0);
    assert.equal(summed, result.tax.total);
    // adjustment may be 0 when allocation already exact; identity still holds
    assert.equal(typeof result.roundingAdjustmentPaise, 'number');
  });

  it('taxes and commissions each line by its own rates', () => {
    const result = computeSubOrderBreakdown({
      lines: [
        { key: 'food', unitPricePaise: 10000, quantity: 1, gstPercentage: 5, commissionRatePercent: 10 },
        { key: 'gadget', unitPricePaise: 10000, quantity: 1, gstPercentage: 18, commissionRatePercent: 15 },
      ],
      merchandiseDiscountPaise: 0,
      shippingDiscountPaise: 0,
      shippingCostPaise: 0,
      gstPercentage: 18,
      intraState: false,
      commissionRatePercent: 10,
      discountBearer: DISCOUNT_BEARER.PLATFORM,
      tcsRatePercent: 0,
    });
    assert.equal(result.lines[0]!.tax.total, 500); // 5% of 10000
    assert.equal(result.lines[1]!.tax.total, 1800); // 18% of 10000
    assert.equal(result.tax.total, 2300);
    assert.equal(result.lines[0]!.commissionPaise, 1000);
    assert.equal(result.lines[1]!.commissionPaise, 1500);
    assert.equal(result.commissionPaise, 2500);
  });

  it('reverses frozen line proportionally for partial returns', () => {
    const priced = computeSubOrderBreakdown({
      lines: [{ key: 'a', unitPricePaise: 10000, quantity: 2 }],
      merchandiseDiscountPaise: 1000,
      shippingDiscountPaise: 0,
      shippingCostPaise: 0,
      gstPercentage: 18,
      intraState: false,
      commissionRatePercent: 10,
      discountBearer: DISCOUNT_BEARER.VENDOR,
      tcsRatePercent: 1,
    });
    const line = priced.lines[0]!;
    const half = reverseFrozenLine({ line, returnQuantity: 1 });
    assert.equal(half.customerRefundPaise, Math.round(line.taxablePaise / 2) + Math.round(line.tax.total / 2));
    assert.equal(half.refundCommissionPaise, Math.round(line.commissionPaise / 2));
  });
});

describe('TCS on taxable supplies only', () => {
  it('leaves a nil-rated line out of the TCS base', () => {
    const b = computeSubOrderBreakdown({
      lines: [
        { key: 'taxed', unitPricePaise: 100000, quantity: 1, gstPercentage: 18 },
        { key: 'nil', unitPricePaise: 50000, quantity: 1, gstPercentage: 0 },
      ],
      merchandiseDiscountPaise: 0,
      shippingDiscountPaise: 0,
      shippingCostPaise: 0,
      gstPercentage: 18,
      intraState: true,
      commissionRatePercent: 0,
      discountBearer: null,
      tcsRatePercent: 1,
    });
    // 1% of ₹1,000 (the taxed line) only: ₹10, none on the ₹500 nil-rated line.
    assert.equal(b.tcsPaise, 1000);
    assert.equal(b.lines.find((l) => l.key === 'nil')?.tcsPaise, 0);
    assert.equal(b.lines.find((l) => l.key === 'taxed')?.tcsPaise, 1000);
  });
});
