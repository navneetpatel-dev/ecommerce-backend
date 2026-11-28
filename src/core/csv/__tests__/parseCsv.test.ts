import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseProductsCsv } from '@modules/products/products.csv';
import { parseCsv } from '../parseCsv';

describe('parsing a CSV file (L2)', () => {
  it('keeps commas, line breaks and quotes inside quoted fields', () => {
    assert.deepEqual(parseCsv('a,b,c\r\n1,"Large, blue","He said ""hi""\nand left"\n'), [
      ['a', 'b', 'c'],
      ['1', 'Large, blue', 'He said "hi"\nand left'],
    ]);
  });

  it('ignores a byte-order mark and blank lines, and keeps empty cells', () => {
    assert.deepEqual(parseCsv('﻿a,b\n\n,2\n'), [['a', 'b'], ['', '2']]);
    assert.deepEqual(parseCsv(''), []);
  });

  it('keeps a quote that is part of an unquoted value', () => {
    assert.deepEqual(parseCsv('size\n12" pan'), [['size'], ['12" pan']]);
  });

  it('reads a product row whose description has a comma', () => {
    const [row] = parseProductsCsv('categoryId,name,description,basePrice\nabc,Mug,"Large, blue",199');
    assert.deepEqual(row, { categoryId: 'abc', name: 'Mug', description: 'Large, blue', basePrice: 199 });
  });
});
