import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ALL_REPORT_DEFINITIONS } from '../definitions';
import { REPORT_COLUMN_LABELS } from '../reports.constants';

describe('U24: every report column has a display name', () => {
  it('no report shows a raw key such as VENDORFREESHIPPINGCOST', () => {
    const missing = ALL_REPORT_DEFINITIONS.flatMap((report) =>
      report.columns
        .filter((column) => !REPORT_COLUMN_LABELS[column.labelKey])
        .map((column) => `${report.type}.${column.labelKey}`),
    );
    assert.deepEqual(missing, []);
  });

  it('the coupon cost report names both free-shipping columns and both recovered columns', () => {
    const report = ALL_REPORT_DEFINITIONS.find((row) => row.type === 'coupon-discount-cost')!;
    const labels = report.columns.map((column) => REPORT_COLUMN_LABELS[column.labelKey]);
    assert.ok(labels.includes('Free-shipping cost (platform)'));
    assert.ok(labels.includes('Free-shipping cost (vendor)'));
    assert.ok(labels.includes('Recovered on returns (platform, incl. GST)'));
    assert.ok(labels.includes('Vendor ID'));
  });
});
