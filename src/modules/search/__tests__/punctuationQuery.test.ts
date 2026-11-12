import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { searchService } from '../search.service';
import { searchRepository } from '../search.repository';
import { AutocompleteQuerySchema } from '../search.dto';
import { searchableLength } from '../search.utils';

describe('punctuation-only search (C-17)', () => {
  afterEach(() => mock.restoreAll());

  it('counts only letters and digits', () => {
    assert.equal(searchableLength('%'), 0);
    assert.equal(searchableLength(' !! '), 0);
    assert.equal(searchableLength('a&b'), 2);
    assert.equal(searchableLength('दाल'), 3);
  });

  it('accepts any short query at the schema instead of a 422', () => {
    assert.equal(AutocompleteQuerySchema.safeParse({ q: '%' }).success, true);
  });

  it('answers punctuation-only queries with nothing, without querying', async () => {
    const auto = mock.method(searchRepository, 'autocomplete', async () => []);
    const list = mock.method(searchRepository, 'searchProducts', async () => []);
    assert.deepEqual(await searchService.autocomplete('%'), []);
    const page = await searchService.searchProducts({ q: '!!', page: 1, limit: 20 } as never);
    assert.deepEqual(page.items, []);
    assert.equal(page.pagination.total, 0);
    assert.equal(auto.mock.callCount() + list.mock.callCount(), 0);
  });
});
