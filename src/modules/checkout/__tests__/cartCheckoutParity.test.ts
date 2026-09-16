import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Vendor } from '@database/models/vendor.model';
import { roundMoney } from '@modules/pricing/money';
import { combinedDiscount } from '@modules/pricing/displayMoney';
import { splitTaxAmount } from '@modules/pricing/pricing.engine';
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

/** Mirrors checkout.service.ts TcsLedger COLLECTION split. */
function checkoutTcsSplit(tcsTotal: number, taxIgst: number) {
  const useIgst = Number(taxIgst ?? 0) > 0;
  return splitTaxAmount(tcsTotal, !useIgst);
}

describe('TcsLedger split at checkout (via priceVendorRows)', () => {
  it('splits intra-state TCS into CGST+SGST matching splitTaxAmount, including odd paise', () => {
    const rows: VendorPricingRow[] = [
      {
        vendorId: 'vendor-intra',
        vendor: vendorStub('KARNATAKA'),
        lines: [
          {
            key: 'odd-tcs',
            vendorId: 'vendor-intra',
            unitPrice: 101,
            quantity: 1,
            categoryId: 'cat-1',
            weightGrams: 500,
          },
        ],
        shippingCost: 0,
        shippingRateFound: true,
        gstPercentage: 18,
        commissionRatePercent: 10,
        lineRates: { 'odd-tcs': { gstPercentage: 18, commissionRatePercent: 10 } },
      },
    ];
    const { pricedByVendor } = priceVendorRows({
      rows,
      shares: { vendorDiscountShares: {}, vendorShippingDiscountShares: {}, vendorBorneDiscountShares: {} },
      shippingStateCode: 'KARNATAKA',
      settings,
    });
    const p = pricedByVendor['vendor-intra']!.paise;
    assert.ok(p.tcsPaise > 0);
    const split = checkoutTcsSplit(p.tcsPaise, p.tax.igst);
    assert.equal(split.cgst + split.sgst + split.igst, p.tcsPaise);
    assert.deepEqual(split, splitTaxAmount(p.tcsPaise, true));
    assert.equal(split.igst, 0);
  });

  it('puts inter-state TCS entirely into IGST', () => {
    const rows = buildRows();
    const { pricedByVendor } = priceVendorRows({
      rows,
      shares,
      shippingStateCode: 'KARNATAKA',
      settings,
    });
    const intra = pricedByVendor['vendor-intra']!.paise;
    const inter = pricedByVendor['vendor-inter']!.paise;

    const intraSplit = checkoutTcsSplit(intra.tcsPaise, intra.tax.igst);
    assert.deepEqual(intraSplit, splitTaxAmount(intra.tcsPaise, true));
    assert.equal(intraSplit.igst, 0);
    assert.equal(intraSplit.cgst + intraSplit.sgst, intra.tcsPaise);

    const interSplit = checkoutTcsSplit(inter.tcsPaise, inter.tax.igst);
    assert.deepEqual(interSplit, splitTaxAmount(inter.tcsPaise, false));
    assert.equal(interSplit.igst, inter.tcsPaise);
    assert.equal(interSplit.cgst, 0);
    assert.equal(interSplit.sgst, 0);
  });

  it('does not silently file intra-state TCS as IGST if useIgst polarity is inverted', () => {
    const tcsTotal = 101;
    const useIgst = false;
    const correct = splitTaxAmount(tcsTotal, !useIgst);
    const invertedWrong = splitTaxAmount(tcsTotal, useIgst);
    assert.deepEqual(correct, { cgst: 50, sgst: 51, igst: 0 });
    assert.deepEqual(invertedWrong, { cgst: 0, sgst: 0, igst: 101 });
    assert.notDeepEqual(correct, invertedWrong);
  });

  it('regression-locks the pre-refactor TCS split formula', () => {
    const snapshots = [
      { tcsTotal: 101, useIgst: false, expected: { cgst: 50, sgst: 51, igst: 0 } },
      { tcsTotal: 101, useIgst: true, expected: { cgst: 0, sgst: 0, igst: 101 } },
      { tcsTotal: 100, useIgst: false, expected: { cgst: 50, sgst: 50, igst: 0 } },
      { tcsTotal: 180, useIgst: true, expected: { cgst: 0, sgst: 0, igst: 180 } },
    ] as const;
    for (const s of snapshots) {
      const split = splitTaxAmount(s.tcsTotal, !s.useIgst);
      assert.deepEqual(split, s.expected);
    }
  });
});
