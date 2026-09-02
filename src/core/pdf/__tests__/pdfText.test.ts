import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBrandedPdfDocument } from '../pdfDocument';
import { assertColumnsFit, buildMeasuredColumns } from '../pdfText';

describe('assertColumnsFit', () => {
  it('proportionally shrinks wide tables without sub-pixel columns', () => {
    const cols = [
      { key: 'a', label: 'A', width: 96, align: 'left' as const },
      { key: 'b', label: 'B', width: 140, align: 'left' as const },
      { key: 'c', label: 'C', width: 75, align: 'left' as const },
      { key: 'd', label: 'D', width: 66, align: 'left' as const },
      { key: 'e', label: 'E', width: 140, align: 'left' as const },
      { key: 'f', label: 'F', width: 56, align: 'left' as const },
      { key: 'g', label: 'G', width: 40, align: 'right' as const },
      { key: 'h', label: 'H', width: 40, align: 'right' as const },
    ];
    const contentWidth = 515;
    assertColumnsFit(contentWidth, cols);
    const sum = cols.reduce((acc, col) => acc + col.width, 0);
    assert.ok(Math.abs(sum - contentWidth) <= 1);
    assert.ok(cols.every((col) => col.width >= 28));
  });
});

describe('buildMeasuredColumns', () => {
  it('fits wallet-statement-like columns on A4', () => {
    const doc = createBrandedPdfDocument({ title: 'Wallet' });
    const contentWidth = doc.page.width - 80;
    const specs = [
      { key: 'createdAt', label: 'Created At', values: ['1 Sep 2026'], minWidth: 56, maxWidth: 140, align: 'left' as const },
      { key: 'type', label: 'Type', values: ['CREDIT'], minWidth: 56, maxWidth: 140, align: 'left' as const },
      { key: 'amount', label: 'Points', values: ['22'], minWidth: 40, maxWidth: 90, align: 'right' as const },
      { key: 'balanceAfter', label: 'Balance (Points)', values: ['2022'], minWidth: 40, maxWidth: 90, align: 'right' as const },
      { key: 'referenceType', label: 'Reference Type', values: ['TOPUP'], minWidth: 56, maxWidth: 140, align: 'left' as const },
      { key: 'referenceId', label: 'Reference ID', values: ['11111111-1111-1111-1111-111111111111'], minWidth: 56, maxWidth: 140, align: 'left' as const },
      { key: 'pointSource', label: 'Point Source', values: ['PURCHASED'], minWidth: 56, maxWidth: 140, align: 'left' as const },
      { key: 'description', label: 'Description', values: ['Points recharge'], minWidth: 56, maxWidth: 140, align: 'left' as const },
    ];
    const cols = buildMeasuredColumns(doc, contentWidth, specs, 'createdAt', 96);
    const sum = cols.reduce((acc, col) => acc + col.width, 0);
    assert.ok(Math.abs(sum - contentWidth) <= 1);
    assert.ok(cols.every((col) => col.width >= 28));
  });
});
