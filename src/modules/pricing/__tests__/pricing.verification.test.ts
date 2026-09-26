import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DISCOUNT_BEARER } from '@core/constants/statuses';
import { computeSubOrderBreakdown, reverseFrozenLine } from '../pricing.engine';

/**
 * Prompt verification scenario (paise-exact, no DB):
 * - Vendor A: category tax override 5%, platform coupon (PLATFORM bearer)
 * - Vendor B: category commission override 12%, vendor coupon (VENDOR bearer)
 * - Customer total + platform-funded coupon = net payouts + commission + TCS + shipping
 * - Partial return of Vendor A line still reconciles
 */
describe('PricingEngine verification scenario', () => {
  it('multi-vendor dual-coupon order reconciles to the paisa, then partial return', () => {
    const vendorA = computeSubOrderBreakdown({
      lines: [{ key: 'food-phone', unitPricePaise: 22836, quantity: 1 }],
      merchandiseDiscountPaise: 2284, // ~10% platform
      vendorBorneMerchandiseDiscountPaise: 0,
      shippingDiscountPaise: 0,
      shippingCostPaise: 4900,
      gstPercentage: 5,
      intraState: false,
      commissionRatePercent: 10,
      discountBearer: DISCOUNT_BEARER.PLATFORM,
      tcsRatePercent: 1,
    });

    const vendorB = computeSubOrderBreakdown({
      lines: [{ key: 'tech-item', unitPricePaise: 20103, quantity: 1 }],
      merchandiseDiscountPaise: 5000, // vendor flat ₹50
      vendorBorneMerchandiseDiscountPaise: 5000,
      shippingDiscountPaise: 0,
      shippingCostPaise: 4900,
      gstPercentage: 18,
      intraState: true,
      commissionRatePercent: 12,
      discountBearer: DISCOUNT_BEARER.VENDOR,
      tcsRatePercent: 1,
    });

    assert.equal(vendorA.commissionBasePaise, vendorA.subtotalPaise);
    assert.equal(vendorB.commissionBasePaise, vendorB.taxablePaise);

    // Every rupee the customer paid, plus what the platform put into its own coupon,
    // goes to a vendor (net, which includes the GST the vendor remits), the platform
    // (commission, shipping) or the government (TCS).
    assert.equal(vendorA.platformFundedDiscountPaise, 2284);
    assert.equal(vendorB.platformFundedDiscountPaise, 0);
    const platformFunded = vendorA.platformFundedDiscountPaise;
    const customerTotal = vendorA.customerTotalPaise + vendorB.customerTotalPaise;
    const accounted = -platformFunded +
      vendorA.netPayoutPaise +
      vendorB.netPayoutPaise +
      vendorA.commissionPaise +
      vendorB.commissionPaise +
      vendorA.tcsPaise +
      vendorB.tcsPaise +
      vendorA.shippingChargedPaise +
      vendorB.shippingChargedPaise;
    assert.equal(customerTotal, accounted);

    // Partial return: full Vendor A line (one item from multi-vendor order)
    const reversal = reverseFrozenLine({
      line: vendorA.lines[0]!,
      returnQuantity: 1,
    });
    assert.equal(reversal.customerRefundPaise, vendorA.lines[0]!.taxablePaise + vendorA.lines[0]!.tax.total);
    assert.equal(reversal.refundCommissionPaise, vendorA.lines[0]!.commissionPaise);
    assert.equal(reversal.refundSubtotalPaise, vendorA.lines[0]!.lineSubtotalPaise);

    // The whole line came back, so the platform's coupon money on it came back too.
    const postCustomer = customerTotal - reversal.customerRefundPaise;
    const postAccounted = -(platformFunded - vendorA.lines[0]!.platformFundedDiscountPaise) +
      vendorA.netPayoutPaise -
      reversal.refundNetClawbackPaise +
      vendorB.netPayoutPaise +
      (vendorA.commissionPaise - reversal.refundCommissionPaise) +
      vendorB.commissionPaise +
      (vendorA.tcsPaise - reversal.refundTcsPaise) +
      vendorB.tcsPaise +
      vendorA.shippingChargedPaise +
      vendorB.shippingChargedPaise;
    assert.equal(postCustomer, postAccounted);
    assert.equal(
      reversal.customerRefundPaise,
      reversal.refundMerchandisePaise + reversal.refundTaxPaise,
    );
    // The vendor gives back its net (which includes the GST and the platform's coupon
    // money), the platform its commission; the platform keeps its coupon money back.
    assert.equal(
      reversal.refundMerchandisePaise + reversal.refundTaxPaise + vendorA.lines[0]!.platformFundedDiscountPaise,
      reversal.refundNetClawbackPaise + reversal.refundCommissionPaise + reversal.refundTcsPaise,
    );
  });
});
