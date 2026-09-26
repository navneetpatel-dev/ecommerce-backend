import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DISCOUNT_BEARER } from '@core/constants/statuses';
import { computeSubOrderBreakdown, splitTaxAmount } from '../pricing.engine';

describe('splitTaxAmount', () => {
  it('splits an even intra-state total equally into CGST and SGST', () => {
    assert.deepEqual(splitTaxAmount(100, true), { cgst: 50, sgst: 50, igst: 0 });
  });

  it('assigns the odd-paise remainder to SGST on intra-state totals', () => {
    assert.deepEqual(splitTaxAmount(101, true), { cgst: 50, sgst: 51, igst: 0 });
  });

  it('puts the entire inter-state total into IGST', () => {
    assert.deepEqual(splitTaxAmount(101, false), { cgst: 0, sgst: 0, igst: 101 });
  });

  it('returns zeros for a zero total', () => {
    assert.deepEqual(splitTaxAmount(0, true), { cgst: 0, sgst: 0, igst: 0 });
  });
});

describe('line GST (via computeSubOrderBreakdown): CGST and SGST at half the rate each', () => {
  const cases = [
    {
      name: 'intra even 18%',
      unitPricePaise: 10000,
      gstPercentage: 18,
      intraState: true,
      tax: { cgst: 900, sgst: 900, igst: 0, total: 1800, gstPercentage: 18 },
    },
    {
      name: 'inter even 18%',
      unitPricePaise: 10000,
      gstPercentage: 18,
      intraState: false,
      tax: { cgst: 0, sgst: 0, igst: 1800, total: 1800, gstPercentage: 18 },
    },
    {
      name: 'intra odd-total 5%',
      unitPricePaise: 101,
      gstPercentage: 5,
      intraState: true,
      // CGST and SGST are each 2.5% of ₹1.01 = 2.525 paise, rounded on their own.
      tax: { cgst: 3, sgst: 3, igst: 0, total: 6, gstPercentage: 5 },
    },
    {
      name: 'inter odd-total 5%',
      unitPricePaise: 101,
      gstPercentage: 5,
      intraState: false,
      tax: { cgst: 0, sgst: 0, igst: 5, total: 5, gstPercentage: 5 },
    },
    {
      name: 'intra 12% on 19999',
      unitPricePaise: 19999,
      gstPercentage: 12,
      intraState: true,
      tax: { cgst: 1200, sgst: 1200, igst: 0, total: 2400, gstPercentage: 12 },
    },
    {
      name: 'intra 28% halves',
      unitPricePaise: 3333,
      gstPercentage: 28,
      intraState: true,
      // 14% of 3333 = 466.62 each: CGST = SGST = 467.
      tax: { cgst: 467, sgst: 467, igst: 0, total: 934, gstPercentage: 28 },
    },
  ] as const;

  for (const c of cases) {
    it(`computes the line GST: ${c.name}`, () => {
      const result = computeSubOrderBreakdown({
        lines: [{ key: 'a', unitPricePaise: c.unitPricePaise, quantity: 1 }],
        merchandiseDiscountPaise: 0,
        shippingDiscountPaise: 0,
        shippingCostPaise: 0,
        gstPercentage: c.gstPercentage,
        intraState: c.intraState,
        commissionRatePercent: 0,
        discountBearer: DISCOUNT_BEARER.PLATFORM,
        tcsRatePercent: 0,
      });
      assert.deepEqual(result.tax, c.tax);
      assert.deepEqual(result.lines[0]!.tax, c.tax);
      assert.equal(result.tax.cgst, result.tax.sgst);
    });
  }

  it('keeps CGST equal to SGST across lines and the order-level rounding adjustment', () => {
    const result = computeSubOrderBreakdown({
      lines: [
        { key: 'a', unitPricePaise: 3333, quantity: 1 },
        { key: 'b', unitPricePaise: 1001, quantity: 3 },
      ],
      merchandiseDiscountPaise: 777,
      shippingDiscountPaise: 0,
      shippingCostPaise: 0,
      gstPercentage: 18,
      intraState: true,
      commissionRatePercent: 0,
      discountBearer: DISCOUNT_BEARER.PLATFORM,
      tcsRatePercent: 0.5,
    });
    assert.equal(result.tax.cgst, result.tax.sgst);
    for (const line of result.lines) assert.equal(line.tax.cgst, line.tax.sgst);
    // TCS is collected as equal CGST + SGST halves too.
    assert.equal(result.tcsPaise % 2, 0);
  });
});
