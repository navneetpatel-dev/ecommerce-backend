import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const ROOT = path.resolve(__dirname, '../..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return entry === '__tests__' ? [] : sources(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

describe('stock given back', () => {
  it('goes through restoreStock only, so waiting shoppers are always told', () => {
    const direct = sources(ROOT)
      .filter((file) => !file.endsWith('inventory/restoreStock.ts'))
      .filter((file) => /increment\(\s*'stock'/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file));
    assert.deepEqual(direct, []);
  });
});
