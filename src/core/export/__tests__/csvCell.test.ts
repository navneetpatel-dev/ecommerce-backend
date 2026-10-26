import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { escapeCsvField, neutralizeCsvFormula } from '../csvCell';
import { buildCsvBuffer } from '@modules/reports/engine/csvExporter';

describe('CSV cells', () => {
  it('keeps text that a spreadsheet would run as a formula as text', () => {
    for (const text of ['=HYPERLINK("http://x","x")', '+1+1', '-2+3', '@SUM(A1)', '\t=1']) {
      assert.equal(neutralizeCsvFormula(text), `'${text}`);
    }
    assert.equal(neutralizeCsvFormula('Acme Traders'), 'Acme Traders');
  });

  it('quotes carriage returns as well as commas, quotes and newlines', () => {
    assert.equal(escapeCsvField('a\rb'), '"a\rb"');
    assert.equal(escapeCsvField('say "hi"'), '"say ""hi"""');
  });

  it('report exports neutralize vendor text but leave numbers alone', () => {
    const csv = buildCsvBuffer(
      [
        { key: 'vendorName', labelKey: 'vendorName' },
        { key: 'amount', labelKey: 'amount', format: 'currency' },
      ],
      [{ vendorName: '=cmd|"/c calc"!A1', amount: -50 }],
    ).toString('utf8');
    const row = csv.split('\n')[1];
    assert.equal(row, `"'=cmd|""/c calc""!A1",-50`);
  });
});
