import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compactFinancialYear,
  formatVendorTaxInvoiceNumber,
  indiaFinancialYear,
  resolveInvoicePrefix,
} from '../vendorInvoiceSequence';

describe('vendorInvoiceSequence helpers', () => {
  it('derives India FY from Asia/Kolkata calendar dates', () => {
    // 31 Mar 2025 18:30 UTC = 1 Apr 2025 IST → FY 2025-26
    assert.equal(indiaFinancialYear(new Date('2025-03-31T18:30:00.000Z')), '2025-26');
    // 31 Mar 2025 12:00 UTC = 31 Mar 2025 IST → FY 2024-25
    assert.equal(indiaFinancialYear(new Date('2025-03-31T12:00:00.000Z')), '2024-25');
    assert.equal(indiaFinancialYear(new Date('2025-04-01T00:00:00.000Z')), '2025-26');
    assert.equal(indiaFinancialYear(new Date('2026-08-31T00:00:00.000Z')), '2026-27');
  });

  it('compacts financial year labels', () => {
    assert.equal(compactFinancialYear('2025-26'), '2526');
    assert.equal(compactFinancialYear('2026-27'), '2627');
  });

  it('resolves invoice prefixes from override then slug', () => {
    assert.equal(resolveInvoicePrefix({ invoicePrefix: 'tw-01' }), 'TW01');
    assert.equal(resolveInvoicePrefix({ slug: 'tech-world' }), 'TECH');
    assert.equal(resolveInvoicePrefix({}), 'PLAT');
  });

  it('formats 8-digit serials that scale past 1M invoices', () => {
    assert.equal(
      formatVendorTaxInvoiceNumber('TW', '2025-26', 1),
      'TW/2526/00000001',
    );
    assert.equal(
      formatVendorTaxInvoiceNumber('TW', '2025-26', 2_000_000),
      'TW/2526/02000000',
    );
    assert.equal(
      formatVendorTaxInvoiceNumber('TW', '2025-26', 99_999_999),
      'TW/2526/99999999',
    );
  });
});
