import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allocateDebitFromBalances } from '../walletBalances';

describe('walletBalances', () => {
  it('allocates debits promotional-first', () => {
    const breakdown = allocateDebitFromBalances(100, {
      purchased: 80,
      promotional: 50,
      total: 130,
    });
    assert.equal(breakdown.promotional, 50);
    assert.equal(breakdown.purchased, 50);
  });
});
