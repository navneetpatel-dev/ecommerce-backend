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

describe('splitTax regression lock (via computeSubOrderBreakdown)', () => {
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
      tax: { cgst: 2, sgst: 3, igst: 0, total: 5, gstPercentage: 5 },
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
      name: 'intra 28% odd remainder',
      unitPricePaise: 3333,
      gstPercentage: 28,
      intraState: true,
      tax: { cgst: 466, sgst: 467, igst: 0, total: 933, gstPercentage: 28 },
    },
  ] as const;

  for (const c of cases) {
    it(`preserves pre-refactor splitTax output: ${c.name}`, () => {
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
    });
  }
});
