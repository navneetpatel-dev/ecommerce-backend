import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Order } from '@database/models/order.model';
import { notificationsService } from '@modules/notifications/notifications.service';
import { isCancelRefund, notifyCancelRefund } from '../cancelRefundNotices';

describe('cancellation refund emails (B-68)', () => {
  afterEach(() => mock.restoreAll());

  it('only covers refunds for cancelled orders or parts', () => {
    assert.equal(isCancelRefund({ reason: 'ORDER_CANCEL', orderId: 'o1' }), true);
    assert.equal(isCancelRefund({ reason: 'SUBORDER_CANCEL', orderId: 'o1', subOrderId: 's1' }), true);
    assert.equal(isCancelRefund({ returnRequestId: 'r1' }), false);
    assert.equal(isCancelRefund({ rechargeId: 'w1' }), false);
  });

  it('emails "refund initiated" with the amount when a cancelled order is refunded', async () => {
    mock.method(Order, 'findByPk', async () => ({ id: 'abcdef12-0000', userId: 'u1' }) as never);
    const started = mock.method(notificationsService, 'sendRefundInitiated', async () => null as never);
    await notifyCancelRefund('started', { reason: 'ORDER_CANCEL', orderId: 'abcdef12-0000' }, 41964);
    const [userId, referenceId, data, referenceType] = started.mock.calls[0]!.arguments as unknown[];
    assert.equal(userId, 'u1');
    assert.equal(referenceId, 'abcdef12-0000');
    assert.equal(referenceType, 'OrderCancelRefund');
    assert.deepEqual(data, { orderId: 'abcdef12-0000', orderNumber: 'ABCDEF12', amount: 419.64 });
  });

  it('emails "refund processed" per cancelled part, keyed by the part', async () => {
    mock.method(Order, 'findByPk', async () => ({ id: 'o1', userId: 'u1' }) as never);
    const done = mock.method(notificationsService, 'sendRefundProcessed', async () => null as never);
    await notifyCancelRefund('processed', { reason: 'SUBORDER_CANCEL', orderId: 'o1', subOrderId: 's9' }, 10000);
    const args = done.mock.calls[0]!.arguments as unknown[];
    assert.equal(args[1], 's9');
    assert.equal(args[3], 'SubOrderCancelRefund');
  });

  it('sends nothing for a return or wallet refund', async () => {
    const started = mock.method(notificationsService, 'sendRefundInitiated', async () => null as never);
    await notifyCancelRefund('started', { returnRequestId: 'r1' }, 100);
    assert.equal(started.mock.calls.length, 0);
  });
});
