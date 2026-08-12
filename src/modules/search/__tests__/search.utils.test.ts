import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAutocompleteLikePatterns, escapeLikePattern } from '../search.utils';

describe('search.utils', () => {
  it('escapes ILIKE metacharacters', () => {
    assert.equal(escapeLikePattern('100%'), '100\\%');
    assert.equal(escapeLikePattern('a_b'), 'a\\_b');
    assert.equal(escapeLikePattern('ca'), 'ca');
  });

  it('builds prefix and infix patterns', () => {
    assert.deepEqual(buildAutocompleteLikePatterns('ca'), {
      prefixPattern: 'ca%',
      infixPattern: '%ca%',
    });
  });
});
