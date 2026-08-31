import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildDatedExportFilename,
  buildTaxInvoicePdfFilename,
  sanitizeFilenameSegment,
} from '../exportFilenames';

describe('exportFilenames', () => {
  it('sanitizes unsafe filename segments', () => {
    assert.equal(sanitizeFilenameSegment('Admin Summary (Q1)'), 'admin-summary-q1');
  });

  it('builds dated export filenames with document key and range', () => {
    const name = buildDatedExportFilename(
      'admin-wallet-liability',
      '2024-01-01',
      '2024-01-31',
      'pdf',
    );
    assert.ok(name.startsWith('admin-wallet-liability_2024-01-01_to_2024-01-31_'));
    assert.ok(name.endsWith('.pdf'));
  });

  it('includes optional suffix segments for scoped exports', () => {
    const name = buildDatedExportFilename(
      'vendor-settlement-summary',
      '2024-01-01',
      '2024-01-31',
      'csv',
      'vendor-abc123',
    );
    assert.ok(name.includes('vendor-settlement-summary_vendor-abc123_'));
  });

  it('builds tax invoice filenames from invoice numbers', () => {
    assert.equal(
      buildTaxInvoicePdfFilename('INV/2024/00042'),
      'gst-tax-invoice_inv-2024-00042.pdf',
    );
  });
});
