import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { REFUND_STATUS } from '@core/constants/statuses';
import { paymentsService } from '../payments.service';
import { failStalledRefunds, retryOrderCancelRefund } from '../orderCancelRefund';

function failedOrder(fields: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    razorpayPaymentId: 'pay_1',
    cancelRefundStatus: REFUND_STATUS.FAILED,
    cancelRefundAmountPaise: 50_000,
    reload: async function reload() {
      return this;
    },
    ...fields,
  };
}

describe('retryOrderCancelRefund', () => {
  afterEach(() => mock.restoreAll());

  it('claims the failed refund, sends it with the cancel notes and records the refund id', async () => {
    mock.method(Order, 'findByPk', async () => failedOrder() as never);
    mock.method(SubOrder, 'count', async () => 0);
    const updates: Array<{ values: Record<string, unknown>; where: Record<string, unknown> }> = [];
    mock.method(Order, 'update', async (values: Record<string, unknown>, options: { where: Record<string, unknown> }) => {
      updates.push({ values, where: options.where });
      return [1] as never;
    });
    const refunds: unknown[] = [];
    mock.method(paymentsService, 'createRazorpayRefund', async (...args: unknown[]) => {
      refunds.push(args);
      return 'rfnd_retry';
    });

    await retryOrderCancelRefund('order-1');

    assert.deepEqual(updates[0], {
      values: { cancelRefundStatus: REFUND_STATUS.PENDING },
      where: { id: 'order-1', cancelRefundStatus: REFUND_STATUS.FAILED },
    });
    assert.deepEqual(refunds, [['pay_1', 50_000, { orderId: 'order-1', reason: 'ORDER_CANCEL' }]]);
    assert.deepEqual(updates[1]?.values, {
      cancelRefundStatus: REFUND_STATUS.INITIATED,
      cancelRazorpayRefundId: 'rfnd_retry',
    });
  });

  it('refuses when another retry already claimed it, without refunding', async () => {
    mock.method(Order, 'findByPk', async () => failedOrder() as never);
    mock.method(SubOrder, 'count', async () => 0);
    mock.method(Order, 'update', async () => [0] as never);
    const refund = mock.method(paymentsService, 'createRazorpayRefund', async () => 'rfnd_x');

    await assert.rejects(retryOrderCancelRefund('order-1'));
    assert.equal(refund.mock.callCount(), 0);
  });

  it('leaves a refund that follows its parts to the part retry', async () => {
    mock.method(Order, 'findByPk', async () => failedOrder() as never);
    mock.method(SubOrder, 'count', async () => 1);
    const refund = mock.method(paymentsService, 'createRazorpayRefund', async () => 'rfnd_x');

    await assert.rejects(retryOrderCancelRefund('order-1'), /cancelled parts/);
    assert.equal(refund.mock.callCount(), 0);
  });

  it('counts a failed try and keeps the refund FAILED for the next run', async () => {
    mock.method(Order, 'findByPk', async () => failedOrder() as never);
    mock.method(SubOrder, 'count', async () => 0);
    const updates: Array<Record<string, unknown>> = [];
    mock.method(Order, 'update', async (values: Record<string, unknown>) => {
      updates.push(values);
      return [1] as never;
    });
    mock.method(paymentsService, 'createRazorpayRefund', async () => {
      throw new Error('gateway down');
    });

    await assert.rejects(retryOrderCancelRefund('order-1'));
    assert.equal(updates.at(-1)?.cancelRefundStatus, REFUND_STATUS.FAILED);
    assert.ok(updates.at(-1)?.cancelRefundLastAttemptAt instanceof Date);
  });
});

describe('failStalledRefunds', () => {
  afterEach(() => mock.restoreAll());

  it('marks refunds started long ago with no Razorpay id as FAILED for the retry job', async () => {
    const wheres: Array<Record<string, unknown>> = [];
    const capture = async (_values: unknown, options: { where: Record<string, unknown> }) => {
      wheres.push(options.where);
      return [1] as never;
    };
    mock.method(ReturnRequest, 'update', capture);
    mock.method(SubOrder, 'update', capture);
    mock.method(Order, 'update', capture);

    const now = new Date('2026-10-18T12:00:00Z');
    const stalled = await failStalledRefunds(now);

    assert.equal(stalled, 3);
    for (const where of wheres) {
      const cutoff = (where.updatedAt as Record<symbol, Date>)[
        Object.getOwnPropertySymbols(where.updatedAt as object)[0]!
      ];
      assert.equal(cutoff.getTime(), now.getTime() - 30 * 60 * 1000);
    }
    assert.equal(wheres[1]?.cancelRazorpayRefundId, null);
  });
});
