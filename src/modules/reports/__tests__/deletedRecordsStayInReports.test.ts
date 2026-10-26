import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

function definition(name: string): string {
  return readFileSync(path.join(__dirname, '..', 'definitions', name), 'utf8');
}

describe('money reports keep records of deleted vendors and products', () => {
  it('never drops a deleted vendor from a finance report join', () => {
    for (const file of ['adminFinance.ts', 'reportGaps.ts']) {
      assert.doesNotMatch(
        definition(file),
        /JOIN vendors v ON v\.id = [^\n]*v\."deletedAt" IS NULL/,
        `${file}: a vendor deleted later vanished from GSTR-8 / 194-O / settlement figures`,
      );
    }
  });

  it('never drops a deleted product from sales and category reports', () => {
    for (const file of ['adminFinance.ts', 'adminCatalog.ts']) {
      const source = definition(file);
      assert.doesNotMatch(source, /JOIN products p ON p\.id = pv\."productId" AND p\."deletedAt" IS NULL/, file);
      assert.doesNotMatch(source, /ON p\.id = pv\."productId"\s+AND p\."deletedAt" IS NULL/, file);
    }
  });
});
