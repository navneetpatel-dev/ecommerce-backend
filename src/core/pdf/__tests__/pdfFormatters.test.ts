import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatInrAmount,
  formatPdfMoney,
  formatPrintDate,
  rupeesInWords,
} from '../pdfFormatters';

describe('pdfFormatters', () => {
  it('groups rupees with the Indian lakh/crore pattern', () => {
    assert.equal(formatInrAmount(384.78), '384.78');
    assert.equal(formatInrAmount(1034.39), '1,034.39');
    assert.equal(formatInrAmount(16730), '16,730.00');
    assert.equal(formatInrAmount(291769.74), '2,91,769.74');
    assert.equal(formatInrAmount(310516.87), '3,10,516.87');
    assert.equal(formatPdfMoney(271371.3), 'Rs 2,71,371.30');
  });

  it('formats print dates from the UTC calendar day', () => {
    assert.equal(formatPrintDate(new Date('2026-08-31T18:30:00.000Z')), '31 Aug 2026');
  });

  it('converts amounts to Indian-system words', () => {
    assert.equal(rupeesInWords(0), 'Rupees Zero Only');
    assert.equal(rupeesInWords(1), 'Rupees One Only');
    assert.equal(
      rupeesInWords(1034.39),
      'Rupees One Thousand Thirty Four and Thirty Nine Paise Only',
    );
    assert.equal(
      rupeesInWords(310516.87),
      'Rupees Three Lakh Ten Thousand Five Hundred Sixteen and Eighty Seven Paise Only',
    );
  });
});
