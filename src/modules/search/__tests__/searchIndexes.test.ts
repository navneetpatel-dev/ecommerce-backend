import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const BASE_SNIPPETS = [
  'pg_trgm',
  'search_vector',
  'products_search_vector_trigger',
  'products_search_vector_update',
  'products_search_vector_idx',
  'products_name_trgm_idx',
] as const;

const EXPAND_SNIPPETS = [
  'products_rebuild_search_vector',
  'businessName',
  'product_variants',
  'vendors_search_vector_trigger',
  'categories_search_vector_trigger',
  'product_variants_search_vector_trigger',
  'vendors_business_name_trgm_idx',
  'categories_name_trgm_idx',
  'product_variants_sku_trgm_idx',
] as const;

describe('product search index contract', () => {
  it('keeps FTS/trigram migration snippets', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const migrationPath = join(
      here,
      '../../../../database/migrations/20240101000087-product-search-indexes.js',
    );
    const blob = readFileSync(migrationPath, 'utf8');

    for (const snippet of BASE_SNIPPETS) {
      assert.ok(blob.includes(snippet), `missing migration snippet: ${snippet}`);
    }
  });

  it('keeps expanded search_vector migration snippets', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const migrationPath = join(
      here,
      '../../../../database/migrations/20240101000088-expand-product-search-vector.js',
    );
    const blob = readFileSync(migrationPath, 'utf8');

    for (const snippet of EXPAND_SNIPPETS) {
      assert.ok(blob.includes(snippet), `missing expand migration snippet: ${snippet}`);
    }
  });
});
