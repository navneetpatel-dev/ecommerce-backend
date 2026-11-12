import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Order } from '@database/models/order.model';
import { PAYMENTS_UNAVAILABLE, discardUnreachedOrder, isProviderUnreachable } from '../paymentProviderErrors';

describe('payment provider unreachable at checkout (B-38)', () => {
  afterEach(() => mock.restoreAll());

  it('recognises network failures and provider 5xx, not shopper mistakes', () => {
    assert.ok(isProviderUnreachable(Object.assign(new Error('connect'), { code: 'ECONNREFUSED' })));
    assert.ok(isProviderUnreachable({ statusCode: 502, error: { description: 'Bad gateway' } }));
    assert.ok(isProviderUnreachable(new TypeError('fetch failed')));
    assert.ok(!isProviderUnreachable({ statusCode: 400, error: { description: 'amount too small' } }));
  });

  it('removes the never-paid order from history and answers 503 with a clear message', async () => {
    const destroy = mock.method(Order, 'destroy', async () => 1 as never);
    const err = (await discardUnreachedOrder('o1', Object.assign(new Error('x'), { code: 'ETIMEDOUT' }))) as { statusCode: number; message: string };
    assert.equal(err.statusCode, 503);
    assert.equal(err.message, PAYMENTS_UNAVAILABLE);
    assert.deepEqual((destroy.mock.calls[0]!.arguments[0] as { where: unknown }).where, { id: 'o1', razorpayOrderId: null });
    const other = new Error('validation');
    assert.equal(await discardUnreachedOrder('o2', other), other);
  });
});
