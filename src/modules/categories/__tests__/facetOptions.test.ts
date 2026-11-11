import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { facetOptionValues } from '../facetOptions';

describe('filter options from attribute data (B-17)', () => {
  it('treats options that are not a list as none, instead of crashing', () => {
    assert.deepEqual(facetOptionValues({ type: 'RANGE', options: { min: 0, max: 100, step: 10 } }), []);
    assert.deepEqual(facetOptionValues({ type: 'ENUM', options: null }), []);
    assert.deepEqual(facetOptionValues({ type: 'ENUM', options: 'Red' }), []);
  });

  it('reads plain values and { value, label } entries, without blanks or repeats', () => {
    assert.deepEqual(facetOptionValues({ type: 'ENUM', options: ['Red', 'Blue', 'Red', '', null] }), ['Red', 'Blue']);
    assert.deepEqual(facetOptionValues({ type: 'ENUM', options: [{ value: 'S', label: 'Small' }, { label: 'Medium' }, 42] }), ['S', 'Medium', '42']);
    assert.deepEqual(facetOptionValues({ type: 'BOOLEAN', options: null }), ['true', 'false']);
  });
});
