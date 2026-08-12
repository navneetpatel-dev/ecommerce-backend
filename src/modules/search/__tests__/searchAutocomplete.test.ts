import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const AUTocomplete_SNIPPETS = [
  'ILIKE :prefixPattern',
  'word_similarity',
  'match_tier',
  'buildAutocompleteLikePatterns',
] as const;

describe('search autocomplete query contract', () => {
  it('uses prefix-first autocomplete ranking in repository', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoPath = join(here, '../search.repository.ts');
    const blob = readFileSync(repoPath, 'utf8');

    for (const snippet of AUTocomplete_SNIPPETS) {
      assert.ok(blob.includes(snippet), `missing repository snippet: ${snippet}`);
    }
  });
});
