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
  it('reads the stored paise value, including BIGINT strings', () => {
    assert.equal(frozenPaise(12345), 12345);
    assert.equal(frozenPaise('12345'), 12345);
  });

  it('treats a stored 0 as a real zero', () => {
    assert.equal(frozenPaise(0), 0);
  });

  it('keeps a negative frozen value (return adjustments)', () => {
    assert.equal(frozenPaise(-5000), -5000);
  });

  it('refuses a missing value instead of publishing a made-up 0', () => {
    // The paise columns are NOT NULL, so null/undefined means the column was not loaded.
    assert.throws(() => frozenPaise(null), /not loaded/);
    assert.throws(() => frozenPaise(undefined), /not loaded/);
  });
});

describe('sqlFrozenPaise', () => {
  it('reads the paise column alone, qualified with the alias', () => {
    assert.equal(sqlFrozenPaise('so', 'subtotalPaise'), 'so."subtotalPaise"');
  });
});

describe('sqlVendorNetPayoutPaise', () => {
  it('reads the frozen net payout paise column', () => {
    assert.equal(sqlVendorNetPayoutPaise('cl'), 'cl."netPayoutAmountPaise"');
  });
});

describe('vendorNetPayoutPaise', () => {
  it('reads the frozen net payout paise value', () => {
    assert.equal(vendorNetPayoutPaise({ netPayoutAmountPaise: 81234 }), 81234);
    assert.equal(vendorNetPayoutPaise({ netPayoutAmountPaise: '-500' }), -500);
  });

  it('refuses a ledger row loaded without its net payout', () => {
    assert.throws(() => vendorNetPayoutPaise({}), /not loaded/);
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
  const frozenLine = {
    id: 'oi-1',
    quantity: 2,
    unitPricePaise: 25000,
    discountAmountPaise: 2000,
    taxableAmountPaise: 48000,
    taxAmountPaise: 8640,
    commissionAmountPaise: 4800,
    tcsAmountPaise: 480,
    netPayoutAmountPaise: 42720,
  };

  it('reads every amount from the frozen paise columns', () => {
    const line = pricingService.frozenLineFromOrderItem(frozenLine);
    assert.equal(line.unitPricePaise, 25000);
    assert.equal(line.lineSubtotalPaise, 50000);
    assert.equal(line.discountPaise, 2000);
    assert.equal(line.commissionPaise, 4800);
    assert.equal(line.tcsPaise, 480);
    assert.equal(line.netPayoutPaise, 42720);
  });

  it('keeps a stored zero', () => {
    const line = pricingService.frozenLineFromOrderItem({
      ...frozenLine,
      discountAmountPaise: 0,
      commissionAmountPaise: 0,
      tcsAmountPaise: 0,
    });
    assert.equal(line.discountPaise, 0);
    assert.equal(line.commissionPaise, 0);
    assert.equal(line.tcsPaise, 0);
  });
});
