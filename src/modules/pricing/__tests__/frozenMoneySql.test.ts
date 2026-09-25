import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  frozenPaise,
  sqlFrozenPaise,
  sqlVendorNetPayoutPaise,
  vendorNetPayoutPaise,
  REPORTABLE_ORDER_SQL,
} from '../frozenMoneySql';
import { pricingService } from '../pricing.service';

function squash(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('frozenPaise', () => {
  it('prefers the frozen paise column', () => {
    assert.equal(frozenPaise(12345, 999), 12345);
  });

  it('falls back to the rupee column only when the paise snapshot is NULL', () => {
    assert.equal(frozenPaise(null, 123.45), 12345);
    assert.equal(frozenPaise(undefined, '123.45'), 12345);
  });

  it('treats a stored 0 as a real zero, not a missing snapshot', () => {
    // A fully refunded line keeps paise 0 while its rupee column may lag.
    assert.equal(frozenPaise(0, 123.45), 0);
  });

  it('treats both-missing as zero', () => {
    assert.equal(frozenPaise(null, null), 0);
    assert.equal(frozenPaise(undefined, 0), 0);
  });

  it('rounds the rupee fallback rather than truncating', () => {
    assert.equal(frozenPaise(null, 0.005), 1);
    assert.equal(frozenPaise(null, 10.999), 1100);
  });

  it('keeps a negative frozen value (return adjustments)', () => {
    assert.equal(frozenPaise(-5000, 0), -5000);
  });
});

describe('sqlFrozenPaise', () => {
  it('reads the paise column first and the rupee column second', () => {
    const sql = squash(sqlFrozenPaise('so', 'subtotalPaise', 'subtotal'));
    assert.match(sql, /^COALESCE\( so\."subtotalPaise", /);
    assert.match(sql, /so\."subtotal", 0\)::numeric \* 100/);
  });

  it('qualifies every column with the given alias', () => {
    const sql = sqlFrozenPaise('oi', 'taxableAmountPaise', 'taxableAmount');
    assert.ok(!/(?<!oi\.)"taxableAmount"/.test(sql.replace(/oi\."taxableAmountPaise"/g, '')));
  });
});

describe('sqlVendorNetPayoutPaise', () => {
  it('subtracts TCS in the last-resort branch', () => {
    // The old inline expression omitted TCS, so vendor dashboard and settlement
    // reports disagreed for any vendor with a TCS component.
    const sql = squash(sqlVendorNetPayoutPaise('cl'));
    assert.match(sql, /cl\."saleAmount"/);
    assert.match(sql, /- COALESCE\(cl\."commissionAmount", 0\)::numeric/);
    assert.match(sql, /- COALESCE\(cl\."tcsAmount", 0\)::numeric/);
  });

  it('prefers the frozen paise column', () => {
    const sql = squash(sqlVendorNetPayoutPaise('cl'));
    assert.match(sql, /^CASE WHEN cl\."netPayoutAmountPaise" IS NOT NULL/);
  });
});

describe('vendorNetPayoutPaise', () => {
  it('prefers the frozen paise column', () => {
    assert.equal(
      vendorNetPayoutPaise({ netPayoutAmountPaise: 81234, netPayoutAmount: 1, saleAmount: 999 }),
      81234,
    );
  });

  it('falls back to the frozen rupee column', () => {
    assert.equal(
      vendorNetPayoutPaise({ netPayoutAmountPaise: null, netPayoutAmount: '812.34', saleAmount: 999 }),
      81234,
    );
  });

  it('derives sale − commission − TCS for pre-engine rows', () => {
    // Payouts, settlement summary, vendor summary and the vendor commission report
    // each used to derive this without TCS, so they paid and reported different nets.
    assert.equal(
      vendorNetPayoutPaise({
        netPayoutAmountPaise: null,
        netPayoutAmount: null,
        saleAmount: '1000.00',
        commissionAmount: '100.00',
        tcsAmount: '10.00',
      }),
      89000,
    );
  });

  it('treats missing TCS on a pre-engine row as zero', () => {
    assert.equal(
      vendorNetPayoutPaise({ netPayoutAmount: null, saleAmount: 500, commissionAmount: 50 }),
      45000,
    );
  });
});

describe('REPORTABLE_ORDER_SQL', () => {
  it('counts paid orders and placed COD orders, excluding cancelled COD', () => {
    const sql = squash(REPORTABLE_ORDER_SQL);
    assert.match(sql, /o\."paymentStatus" = 'PAID'/);
    assert.match(sql, /o\."paymentMethod" = 'COD'/);
    assert.match(sql, /o\."paymentStatus" NOT IN \('FAILED', 'REFUNDED'\)/);
    assert.match(sql, /o\."status" <> 'CANCELLED'/);
  });
});

describe('pricingService.frozenLineFromOrderItem', () => {
  const legacyLine = {
    id: 'oi-legacy',
    quantity: 2,
    unitPrice: 250,
    discountAmount: 20,
    taxableAmount: 480,
    taxAmount: 86.4,
    commissionAmount: 48,
    tcsAmount: 4.8,
    netPayoutAmount: 427.2,
  };

  it('reads rupee columns for a line written before paise snapshots', () => {
    // Return reversals used to pass Number(paise ?? 0), so a pre-snapshot line
    // reversed zero commission, TCS and discount.
    const line = pricingService.frozenLineFromOrderItem({
      ...legacyLine,
      unitPricePaise: null,
      discountAmountPaise: null,
      taxableAmountPaise: null,
      taxAmountPaise: null,
      commissionAmountPaise: null,
      tcsAmountPaise: null,
      netPayoutAmountPaise: null,
    });
    assert.equal(line.unitPricePaise, 25000);
    assert.equal(line.discountPaise, 2000);
    assert.equal(line.commissionPaise, 4800);
    assert.equal(line.tcsPaise, 480);
    assert.equal(line.netPayoutPaise, 42720);
  });

  it('keeps a stored zero instead of falling back', () => {
    const line = pricingService.frozenLineFromOrderItem({
      ...legacyLine,
      unitPricePaise: 25000,
      discountAmountPaise: 0,
      taxableAmountPaise: 50000,
      taxAmountPaise: 9000,
      commissionAmountPaise: 0,
      tcsAmountPaise: 0,
      netPayoutAmountPaise: 50000,
    });
    assert.equal(line.discountPaise, 0);
    assert.equal(line.commissionPaise, 0);
    assert.equal(line.tcsPaise, 0);
  });
});
