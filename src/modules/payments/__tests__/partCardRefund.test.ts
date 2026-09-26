import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { ORDER_STATUS, REFUND_STATUS } from '@core/constants/statuses';
import { paymentsService } from '@modules/payments/payments.service';
import { retryPartCardRefund } from '@modules/payments/partCardRefund';

describe('retryPartCardRefund', () => {
  afterEach(() => mock.restoreAll());

  function stubRows(input: { partStatus: string; orderRefundStatus: string; claimed?: number }) {
    const part = {
      id: 'sub-1',
      orderId: 'order-1',
      status: ORDER_STATUS.CANCELLED,
      cancelRefundAmountPaise: 25_000,
      cancelRefundStatus: input.partStatus,
      reload: async () => part,
    };
    mock.method(SubOrder, 'findByPk', async () => part as never);
    mock.method(Order, 'findByPk', async () => ({
      id: 'order-1',
      razorpayPaymentId: 'pay_1',
      cancelRefundStatus: input.orderRefundStatus,
    }) as never);
    mock.method(SubOrder, 'findAll', async () => [
      { id: 'sub-1', status: ORDER_STATUS.CANCELLED, cancelRefundStatus: input.partStatus },
      { id: 'sub-2', status: ORDER_STATUS.CANCELLED, cancelRefundStatus: REFUND_STATUS.COMPLETED },
    ] as never);
    const subOrderUpdates: Array<Record<string, unknown>> = [];
    let claims = 0;
    mock.method(SubOrder, 'update', async (values: Record<string, unknown>) => {
      subOrderUpdates.push(values);
      if (values.cancelRefundStatus === REFUND_STATUS.PENDING) {
        claims += 1;
        return [input.claimed ?? 1] as never;
      }
      return [1] as never;
    });
    const orderUpdates: Array<Record<string, unknown>> = [];
    mock.method(Order, 'update', async (values: Record<string, unknown>) => {
      orderUpdates.push(values);
      return [1] as never;
    });
    return { subOrderUpdates, orderUpdates, claimCount: () => claims };
  }

  it('re-issues the recorded amount and moves the order off FAILED when it was the last part', async () => {
    const rows = stubRows({ partStatus: REFUND_STATUS.FAILED, orderRefundStatus: REFUND_STATUS.FAILED });
    const refund = mock.method(paymentsService, 'createRazorpayRefund', async () => 'rfnd_retry');

    await retryPartCardRefund('sub-1');

    assert.deepEqual(refund.mock.calls[0]!.arguments.slice(0, 2), ['pay_1', 25_000]);
    assert.deepEqual(rows.subOrderUpdates.at(-1), {
      cancelRefundStatus: REFUND_STATUS.INITIATED,
      cancelRazorpayRefundId: 'rfnd_retry',
    });
    assert.deepEqual(rows.orderUpdates, [
      { cancelRefundStatus: REFUND_STATUS.INITIATED, cancelRazorpayRefundId: 'rfnd_retry' },
    ]);
  });

  it('refuses a part whose refund has not failed', async () => {
    stubRows({ partStatus: REFUND_STATUS.INITIATED, orderRefundStatus: REFUND_STATUS.INITIATED });
    const refund = mock.method(paymentsService, 'createRazorpayRefund', async () => 'rfnd_x');
    await assert.rejects(retryPartCardRefund('sub-1'));
    assert.equal(refund.mock.callCount(), 0);
  });

  it('does not refund twice when another retry claimed it first', async () => {
    stubRows({ partStatus: REFUND_STATUS.FAILED, orderRefundStatus: REFUND_STATUS.INITIATED, claimed: 0 });
    const refund = mock.method(paymentsService, 'createRazorpayRefund', async () => 'rfnd_x');
    await assert.rejects(retryPartCardRefund('sub-1'));
    assert.equal(refund.mock.callCount(), 0);
  });

  it('keeps the part FAILED and reports it when the gateway refuses again', async () => {
    const rows = stubRows({ partStatus: REFUND_STATUS.FAILED, orderRefundStatus: REFUND_STATUS.INITIATED });
    mock.method(paymentsService, 'createRazorpayRefund', async () => {
      throw new Error('gateway down');
    });
    await assert.rejects(retryPartCardRefund('sub-1'));
    assert.deepEqual(rows.subOrderUpdates.at(-1), { cancelRefundStatus: REFUND_STATUS.FAILED });
    assert.deepEqual(rows.orderUpdates, []);
  });
});
