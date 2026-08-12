import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const EXPECTED_SNIPPETS = [
  'pg_trgm',
  'search_vector',
  'products_search_vector_trigger',
  'products_search_vector_update',
  'products_search_vector_idx',
  'products_name_trgm_idx',
  'products_live_category_idx',
  'products_live_vendor_idx',
  'products_live_category_price_idx',
] as const;

describe('product search index contract', () => {
  it('keeps FTS/trigram migration snippets', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const migrationPath = join(
      here,
      '../../../../database/migrations/20240101000087-product-search-indexes.js',
    );
    const blob = readFileSync(migrationPath, 'utf8');

    for (const snippet of EXPECTED_SNIPPETS) {
      assert.ok(blob.includes(snippet), `missing migration snippet: ${snippet}`);
    }
  });
});
