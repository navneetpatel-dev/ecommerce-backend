import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const AUTOCOMPLETE_SNIPPETS = [
  'ILIKE :prefixPattern',
  'word_similarity',
  'match_tier',
  'buildAutocompleteLikePatterns',
  'SEARCH_SUGGESTION_TYPE.PRODUCT',
  'SEARCH_SUGGESTION_TYPE.VENDOR',
  'SEARCH_SUGGESTION_TYPE.CATEGORY',
  'product_variants',
  'businessName',
] as const;

describe('search autocomplete query contract', () => {
  it('uses mixed-type prefix-first autocomplete in repository', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoPath = join(here, '../search.repository.ts');
    const blob = readFileSync(repoPath, 'utf8');

    for (const snippet of AUTOCOMPLETE_SNIPPETS) {
      assert.ok(blob.includes(snippet), `missing repository snippet: ${snippet}`);
    }
  });
});
