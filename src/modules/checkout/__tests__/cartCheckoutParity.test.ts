import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Vendor } from '@database/models/vendor.model';
import { roundMoney } from '@modules/pricing/money';
import { combinedDiscount } from '@modules/pricing/displayMoney';
import { buildCheckoutOrderTotals } from '../checkoutOrderTotals';
import { priceVendorRows, type VendorPricingRow } from '../vendorPricingPlan';
import type { PlatformSettingsPayload } from '@modules/settings/settings.service';

/**
 * Cart preview, checkout quote and order creation all price through
 * `priceVendorRows`. This asserts the two aggregation styles layered on top of it
 * still agree — the cart page total must equal the checkout total for one cart.
 *
 * Guards the regression this shared path was introduced to remove: three separate
 * "group by vendor and price it" implementations that could silently drift.
 */

const settings = {
  defaultCommissionRate: 10,
  tcsRatePercent: 1,
} as PlatformSettingsPayload;

function vendorStub(state: string): Vendor {
  return { state, commissionRate: 10 } as Vendor;
}

/** Two vendors: one intra-state (CGST/SGST), one inter-state (IGST). */
function buildRows(): VendorPricingRow[] {
  return [
    {
      vendorId: 'vendor-intra',
      vendor: vendorStub('KARNATAKA'),
      lines: [
        {
          key: 'line-1',
          vendorId: 'vendor-intra',
          unitPrice: 499.5,
          quantity: 3,
          categoryId: 'cat-1',
          weightGrams: 500,
        },
        {
          key: 'line-2',
          vendorId: 'vendor-intra',
          unitPrice: 120.25,
          quantity: 2,
          categoryId: 'cat-1',
          weightGrams: 250,
        },
      ],
      shippingCost: 59,
      shippingRateFound: true,
      gstPercentage: 18,
      commissionRatePercent: 10,
      lineRates: {
        'line-1': { gstPercentage: 18, commissionRatePercent: 10 },
        'line-2': { gstPercentage: 12, commissionRatePercent: 8 },
      },
    },
    {
      vendorId: 'vendor-inter',
      vendor: vendorStub('MAHARASHTRA'),
      lines: [
        {
          key: 'line-3',
          vendorId: 'vendor-inter',
          unitPrice: 1999.99,
          quantity: 1,
          categoryId: 'cat-2',
          weightGrams: 1200,
        },
      ],
      shippingCost: 99,
      shippingRateFound: true,
      gstPercentage: 5,
      commissionRatePercent: 12,
      lineRates: {
        'line-3': { gstPercentage: 5, commissionRatePercent: 12 },
      },
    },
  ];
}

const shares = {
  vendorDiscountShares: { 'vendor-intra': 150.75, 'vendor-inter': 300 },
  vendorShippingDiscountShares: { 'vendor-intra': 59 },
  vendorBorneDiscountShares: { 'vendor-inter': 300 },
};

/** How cart.service.ts sums the priced rows for `pricingPreview`. */
function cartStyleTotals(priced: ReturnType<typeof priceVendorRows>['pricedByVendor']) {
  let discount = 0;
  let taxTotal = 0;
  let shippingTotal = 0;
  let grandTotal = 0;
  for (const entry of Object.values(priced)) {
    const r = entry.rupees;
    discount += combinedDiscount(r.merchandiseDiscount, r.shippingDiscount);
    taxTotal += r.tax.total;
    shippingTotal += r.shippingCharged;
    grandTotal += r.customerTotal;
  }
  return {
    discountTotal: roundMoney(discount),
    taxTotal: roundMoney(taxTotal),
    shippingTotal: roundMoney(shippingTotal),
    grandTotal: roundMoney(grandTotal),
  };
}

/** How checkout.service.ts shapes vendor breakdowns before aggregating them. */
function checkoutStyleTotals(rows: VendorPricingRow[], priced: ReturnType<typeof priceVendorRows>['pricedByVendor']) {
  const vendorBreakdowns = rows.map((row) => {
    const r = priced[row.vendorId]!.rupees;
    return {
      subtotal: r.subtotal,
      shippingCost: r.shippingCharged,
      tax: { cgst: r.tax.cgst, sgst: r.tax.sgst, igst: r.tax.igst, total: r.tax.total },
      discount: combinedDiscount(r.merchandiseDiscount, r.shippingDiscount),
      total: r.customerTotal,
    };
  });
  return {
    orderTotals: buildCheckoutOrderTotals(vendorBreakdowns),
    grandTotal: roundMoney(vendorBreakdowns.reduce((sum, row) => sum + row.total, 0)),
  };
}

describe('cart / checkout pricing parity', () => {
  it('produces the same totals from the cart and checkout aggregation paths', () => {
    const rows = buildRows();
    const { pricedByVendor } = priceVendorRows({
      rows,
      shares,
      shippingStateCode: 'KARNATAKA',
      settings,
    });

    const cart = cartStyleTotals(pricedByVendor);
    const checkout = checkoutStyleTotals(rows, pricedByVendor);

    assert.equal(cart.grandTotal, checkout.grandTotal);
    assert.equal(cart.taxTotal, checkout.orderTotals.taxTotal);
    assert.equal(cart.shippingTotal, checkout.orderTotals.shippingTotal);
    assert.equal(cart.discountTotal, checkout.orderTotals.discountTotal);
  });

  it('keeps the paise grand total consistent with the rupee sum', () => {
    const rows = buildRows();
    const { pricedByVendor, customerGrandTotalPaise } = priceVendorRows({
      rows,
      shares,
      shippingStateCode: 'KARNATAKA',
      settings,
    });

    const rupeeSum = roundMoney(Object.values(pricedByVendor).reduce((sum, entry) => sum + entry.rupees.customerTotal, 0));
    assert.equal(customerGrandTotalPaise / 100, rupeeSum);
  });

  it('charges IGST inter-state and CGST/SGST intra-state from one shipping state', () => {
    const rows = buildRows();
    const { pricedByVendor } = priceVendorRows({
      rows,
      shares,
      shippingStateCode: 'KARNATAKA',
      settings,
    });

    const intra = pricedByVendor['vendor-intra']!.rupees.tax;
    const inter = pricedByVendor['vendor-inter']!.rupees.tax;

    assert.equal(intra.igst, 0);
    assert.ok(intra.cgst > 0 && intra.sgst > 0);
    assert.ok(inter.igst > 0);
    assert.equal(inter.cgst, 0);
    assert.equal(inter.sgst, 0);
  });

  it('caps a shipping discount at the vendor shipping cost', () => {
    const rows = buildRows();
    const { pricedByVendor } = priceVendorRows({
      rows,
      // Coupon offers more free shipping than this vendor actually charges.
      shares: { ...shares, vendorShippingDiscountShares: { 'vendor-intra': 500 } },
      shippingStateCode: 'KARNATAKA',
      settings,
    });

    const intra = pricedByVendor['vendor-intra']!.rupees;
    assert.equal(intra.shippingDiscount, 59);
    assert.equal(intra.shippingCharged, 0);
  });

  it('falls back to the vendor state when no shipping state is known (cart, no address)', () => {
    const rows = buildRows();
    const { pricedByVendor } = priceVendorRows({
      rows,
      shares,
      shippingStateCode: '',
      settings,
    });

    // Each vendor ships to itself, so both buckets are intra-state.
    for (const entry of Object.values(pricedByVendor)) {
      assert.equal(entry.rupees.tax.igst, 0);
    }
  });
});
