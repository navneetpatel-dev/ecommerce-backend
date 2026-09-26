import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { VENDOR_ENTITY_TYPE } from '@core/constants/statuses';
import { sequelize } from '@database/models';
import { istFinancialYearStart } from '@modules/pricing/istCalendar';
import { qualifiesFor194oExemption, tdsRateForSale } from '@modules/pricing/tds194o';

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
