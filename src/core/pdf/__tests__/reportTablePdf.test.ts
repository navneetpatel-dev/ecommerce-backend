import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderReportTablePdf } from '../reportTablePdf';

describe('renderReportTablePdf', () => {
  it('writes a branded table PDF buffer', async () => {
    const pdf = await renderReportTablePdf({
      title: 'Vendor settlements',
      subtitle: 'Jan 2026',
      columns: [
        { key: 'vendorName', label: 'Vendor' },
        { key: 'gmv', label: 'GMV', align: 'right' },
        { key: 'tax', label: 'Tax', align: 'right' },
      ],
      rows: [
        { vendorName: 'TechWorld Electronics Max 222', gmv: 271371.3, tax: 13568.56 },
        { vendorName: 'FitnessFlex', gmv: 1034.39, tax: 289.63 },
      ],
    });
    assert.ok(pdf.length > 1000);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  });
});
