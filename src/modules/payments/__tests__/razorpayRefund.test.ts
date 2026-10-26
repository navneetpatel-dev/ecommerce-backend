import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { razorpay } from '@config/razorpay';
import { createIdempotentRazorpayRefund } from '../razorpayRefund';

describe('createIdempotentRazorpayRefund', () => {
  afterEach(() => mock.restoreAll());

  function stubRefunds(items: Array<Record<string, unknown>>) {
    mock.method(razorpay.payments, 'fetchMultipleRefund', async () => ({ items, count: items.length }) as never);
    return mock.method(razorpay.payments, 'refund', async () => ({ id: 'rfnd_new' }) as never);
  }

  it('adopts a refund already made for the same purpose instead of refunding twice', async () => {
    const create = stubRefunds([
      { id: 'rfnd_done', amount: 5000, status: 'processed', notes: { returnRequestId: 'ret-1' } },
    ]);
    const id = await createIdempotentRazorpayRefund('pay_1', 5000, { returnRequestId: 'ret-1' });
    assert.equal(id, 'rfnd_done');
    assert.equal(create.mock.callCount(), 0);
  });

  it('creates a refund when only a failed, different-purpose or different-amount one exists', async () => {
    const create = stubRefunds([
      { id: 'rfnd_failed', amount: 5000, status: 'failed', notes: { returnRequestId: 'ret-1' } },
      { id: 'rfnd_other', amount: 5000, status: 'processed', notes: { returnRequestId: 'ret-2' } },
      { id: 'rfnd_less', amount: 4000, status: 'processed', notes: { returnRequestId: 'ret-1' } },
    ]);
    const id = await createIdempotentRazorpayRefund('pay_1', 5000, { returnRequestId: 'ret-1' });
    assert.equal(id, 'rfnd_new');
    assert.equal(create.mock.callCount(), 1);
  });
});
