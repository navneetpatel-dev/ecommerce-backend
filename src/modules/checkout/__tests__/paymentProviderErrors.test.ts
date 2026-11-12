import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Order } from '@database/models/order.model';
import { AppError } from '@core/errors/AppError';
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
    const ours = new AppError('Some items in your cart are no longer available', 422, 'ITEMS_UNAVAILABLE');
    assert.equal(await discardUnreachedOrder('o2', ours), ours);
  });

  it('answers the same 503 when the provider refuses the request (401, 403, 429)', async () => {
    mock.method(Order, 'destroy', async () => 1 as never);
    for (const statusCode of [401, 403, 429]) {
      const err = (await discardUnreachedOrder('o3', { statusCode })) as { statusCode: number; message: string };
      assert.equal(err.statusCode, 503, `provider ${statusCode}`);
      assert.equal(err.message, PAYMENTS_UNAVAILABLE);
    }
  });
});

describe('toPaymentsUnavailable (wallet top-up and gift card purchase)', () => {
  it('turns a provider refusal into the same 503 and keeps our own errors', async () => {
    const { toPaymentsUnavailable } = await import('../paymentProviderErrors');
    const err = toPaymentsUnavailable({ statusCode: 401, error: { description: 'Authentication failed' } }, { rechargeId: 'w1' }) as { statusCode: number };
    assert.equal(err.statusCode, 503);
    const ours = new AppError('Amount too low', 422, 'VALIDATION_ERROR');
    assert.equal(toPaymentsUnavailable(ours, {}), ours);
  });
});
