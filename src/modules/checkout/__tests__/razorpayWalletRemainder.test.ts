import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clampWalletApply,
  settleSubMinRazorpayRemainder,
} from '../razorpayWalletRemainder';

describe('clampWalletApply', () => {
  it('clamps to requested, balance, and order total', () => {
    assert.equal(clampWalletApply(80, 50, 100), 50);
    assert.equal(clampWalletApply(80, 200, 100), 80);
    assert.equal(clampWalletApply(120, 200, 100), 100);
  });
});

describe('settleSubMinRazorpayRemainder', () => {
  it('absorbs sub-₹1 remainder into full wallet when balance covers the order', () => {
    const settled = settleSubMinRazorpayRemainder(100.5, 100, 150);
    assert.ok(!('reject' in settled));
    if ('reject' in settled) return;
    assert.equal(settled.walletAmountUsed, 100.5);
    assert.equal(settled.amountDue, 0);
  });

  it('rejects when remainder is below ₹1 and balance cannot cover the order', () => {
    const settled = settleSubMinRazorpayRemainder(100.5, 100, 100);
    assert.deepEqual(settled, { reject: true });
  });

  it('leaves normal remainders unchanged', () => {
    const settled = settleSubMinRazorpayRemainder(200, 50, 50);
    assert.ok(!('reject' in settled));
    if ('reject' in settled) return;
    assert.equal(settled.walletAmountUsed, 50);
    assert.equal(settled.amountDue, 150);
  });
});
