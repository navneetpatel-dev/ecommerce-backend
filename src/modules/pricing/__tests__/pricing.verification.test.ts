import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DISCOUNT_BEARER } from '@core/constants/statuses';
import { computeSubOrderBreakdown, reverseFrozenLine } from '../pricing.engine';

/**
 * Prompt verification scenario (paise-exact, no DB):
 * - Vendor A: category tax override 5%, platform coupon (PLATFORM bearer)
 * - Vendor B: category commission override 12%, vendor coupon (VENDOR bearer)
 * - Customer total = net payouts + commission + tax + TCS + shipping
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

    const customerTotal = vendorA.customerTotalPaise + vendorB.customerTotalPaise;
    const accounted =
      vendorA.netPayoutPaise +
      vendorB.netPayoutPaise +
      vendorA.commissionPaise +
      vendorB.commissionPaise +
      vendorA.tax.total +
      vendorB.tax.total +
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

    const postCustomer = customerTotal - reversal.customerRefundPaise;
    const postAccounted =
      vendorA.netPayoutPaise -
      reversal.refundNetClawbackPaise +
      vendorB.netPayoutPaise +
      (vendorA.commissionPaise - reversal.refundCommissionPaise) +
      vendorB.commissionPaise +
      (vendorA.tax.total - reversal.refundTaxPaise) +
      vendorB.tax.total +
      (vendorA.tcsPaise - reversal.refundTcsPaise) +
      vendorB.tcsPaise +
      vendorA.shippingChargedPaise +
      vendorB.shippingChargedPaise;
    assert.equal(postCustomer, postAccounted);
    assert.equal(
      reversal.customerRefundPaise,
      reversal.refundMerchandisePaise + reversal.refundTaxPaise,
    );
    assert.equal(
      reversal.refundMerchandisePaise,
      reversal.refundNetClawbackPaise + reversal.refundCommissionPaise + reversal.refundTcsPaise,
    );
  });
});
