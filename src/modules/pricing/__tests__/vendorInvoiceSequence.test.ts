import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compactFinancialYear,
  formatVendorDocumentNumber,
  formatVendorTaxInvoiceNumber,
  indiaFinancialYear,
  resolveInvoicePrefix,
  VENDOR_DOCUMENT_KIND,
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
    assert.equal(resolveInvoicePrefix({ slug: 'tech-world' }), 'TECHORLD');
    assert.equal(
      resolveInvoicePrefix({ slug: 'refund-vendor-abc12xyz' }),
      'REFU2XYZ',
    );
    assert.equal(resolveInvoicePrefix({}), 'PLAT');
    assert.equal(
      resolveInvoicePrefix({ vendorId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
      'A1B2C3D4',
    );
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

  it('formats vendor-scoped credit and debit notes against FY series', () => {
    assert.equal(
      formatVendorDocumentNumber('TW', '2025-26', 7, VENDOR_DOCUMENT_KIND.CREDIT_NOTE),
      'TW/CN/2526/00000007',
    );
    assert.equal(
      formatVendorDocumentNumber('TW', '2025-26', 3, VENDOR_DOCUMENT_KIND.DEBIT_NOTE),
      'TW/DN/2526/00000003',
    );
    assert.equal(
      formatVendorDocumentNumber('PLAT', '2025-26', 1, VENDOR_DOCUMENT_KIND.COMMISSION_INVOICE),
      'PLAT/COM/2526/00000001',
    );
  });
});
