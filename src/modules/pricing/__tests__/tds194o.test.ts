import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { VENDOR_ENTITY_TYPE } from '@core/constants/statuses';
import { sequelize } from '@database/models';
import { istFinancialYearStart } from '@modules/pricing/istCalendar';
import { qualifiesFor194oExemption, tds194oCatchUp, tdsRateForSale } from '@modules/pricing/tds194o';

describe('istFinancialYearStart', () => {
  it('starts the financial year at 1 April, midnight IST', () => {
    // 1 April 2026 00:00 IST is 31 March 2026 18:30 UTC.
    assert.equal(istFinancialYearStart(new Date('2026-09-26T10:00:00Z')).toISOString(), '2026-03-31T18:30:00.000Z');
    assert.equal(istFinancialYearStart(new Date('2027-02-10T10:00:00Z')).toISOString(), '2026-03-31T18:30:00.000Z');
    // 31 March 2026 20:00 UTC is already 1 April in India.
    assert.equal(istFinancialYearStart(new Date('2026-03-31T20:00:00Z')).toISOString(), '2026-03-31T18:30:00.000Z');
    assert.equal(istFinancialYearStart(new Date('2026-03-31T17:00:00Z')).toISOString(), '2025-03-31T18:30:00.000Z');
  });
});

describe('194-O(4) exemption', () => {
  afterEach(() => mock.restoreAll());

  const sole = VENDOR_ENTITY_TYPE.SOLE_PROPRIETORSHIP;

  it('exempts a sole proprietor within the threshold, this sale included', () => {
    const base = { entityType: sole, thresholdRupees: 500_000 };
    assert.equal(qualifiesFor194oExemption({ ...base, financialYearGrossPaise: 40_000_000, saleTaxablePaise: 10_000_000 }), true);
    assert.equal(qualifiesFor194oExemption({ ...base, financialYearGrossPaise: 40_000_000, saleTaxablePaise: 10_000_001 }), false);
  });

  it('never exempts a company or firm, or when the threshold is 0', () => {
    const sale = { financialYearGrossPaise: 0, saleTaxablePaise: 100 };
    assert.equal(
      qualifiesFor194oExemption({ ...sale, entityType: VENDOR_ENTITY_TYPE.PRIVATE_LIMITED, thresholdRupees: 500_000 }),
      false,
    );
    assert.equal(qualifiesFor194oExemption({ ...sale, entityType: sole, thresholdRupees: 0 }), false);
  });

  it('freezes 0% TDS for an exempt sale and the platform rate otherwise', async () => {
    let grossPaise = 0;
    mock.method(sequelize, 'query', async () => [{ grossPaise }] as never);
    const settings = { tdsRatePercent: 0.1, tds194oExemptionThreshold: 500_000 };

    assert.equal(await tdsRateForSale({ vendorId: 'v1', entityType: sole, saleTaxablePaise: 100_000, settings }), 0);
    grossPaise = 49_950_000;
    assert.equal(await tdsRateForSale({ vendorId: 'v1', entityType: sole, saleTaxablePaise: 100_000, settings }), 0.1);
    assert.equal(
      await tdsRateForSale({ vendorId: 'v1', entityType: VENDOR_ENTITY_TYPE.LLP, saleTaxablePaise: 100, settings }),
      0.1,
    );
  });
});

describe('194-O(4) catch-up', () => {
  afterEach(() => mock.restoreAll());
  const sole = VENDOR_ENTITY_TYPE.SOLE_PROPRIETORSHIP;
  const settings = { tdsRatePercent: 1, tds194oExemptionThreshold: 5_000 };

  function mockYear(grossPaise: number, basePaise: number, takenPaise: number) {
    mock.method(sequelize, 'query', async (sql: string) =>
      (String(sql).includes('"takenPaise"') ? [{ basePaise, takenPaise }] : [{ grossPaise }]) as never,
    );
  }

  it('takes nothing while the year is within the limit', async () => {
    mockYear(400_000, 400_000, 0);
    const result = await tds194oCatchUp({ vendorId: 'v1', entityType: sole, settings, batchLedgerIds: ['cl-1'] });
    assert.equal(result.tdsPaise, 0);
  });

  it('once over the limit, taxes the earlier exempt sales too, less catch-up already taken', async () => {
    // ₹6,000 of sales this year against a ₹5,000 limit, all frozen as exempt.
    mockYear(600_000, 600_000, 0);
    const first = await tds194oCatchUp({ vendorId: 'v1', entityType: sole, settings, batchLedgerIds: ['cl-1'] });
    assert.equal(first.tdsPaise, 6_000);
    // A later payout: ₹60 already taken, ₹1,000 more exempt sales since → ₹10 more.
    mockYear(700_000, 700_000, 6_000);
    const second = await tds194oCatchUp({ vendorId: 'v1', entityType: sole, settings, batchLedgerIds: ['cl-2'] });
    assert.equal(second.tdsPaise, 1_000);
  });

  it('never applies to a company', async () => {
    mockYear(600_000, 600_000, 0);
    const result = await tds194oCatchUp({
      vendorId: 'v1',
      entityType: VENDOR_ENTITY_TYPE.PRIVATE_LIMITED,
      settings,
      batchLedgerIds: [],
    });
    assert.equal(result.tdsPaise, 0);
  });
});
