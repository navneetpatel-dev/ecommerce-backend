import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { notificationsService } from '../notifications.service';
import { notifyOrderConfirmed } from '../orderNotifications';
import { renderNotificationEmail } from '../templates/registry';

function stubOrder(paymentStatus: string) {
  mock.method(Order, 'findByPk', async () => ({ id: 'abcdef12-0000', userId: 'u1', totalAmount: 3863.21, paymentStatus, subOrders: [] }) as never);
  mock.method(SubOrder, 'findAll', async () => [] as never);
  const confirmation = mock.method(notificationsService, 'sendOrderConfirmation', async () => null as never);
  const receipt = mock.method(notificationsService, 'sendPaymentReceipt', async () => null as never);
  return { confirmation, receipt };
}

describe('order confirmed emails (B-31)', () => {
  afterEach(() => mock.restoreAll());

  it('sends no payment receipt for an unpaid cash-on-delivery order', async () => {
    const { confirmation, receipt } = stubOrder('PENDING');
    await notifyOrderConfirmed('abcdef12-0000');
    assert.equal(confirmation.mock.callCount(), 1);
    assert.equal(receipt.mock.callCount(), 0);
  });

  it('sends the receipt once the order is paid', async () => {
    const { receipt } = stubOrder('PAID');
    await notifyOrderConfirmed('abcdef12-0000');
    assert.equal(receipt.mock.callCount(), 1);
  });

  it('writes amounts with Indian grouping and two decimals', () => {
    assert.match(renderNotificationEmail('ORDER_CONFIRMATION', { orderNumber: 'X', total: 3863.21 }).text, /₹3,863\.21/);
    assert.match(renderNotificationEmail('REFUND_PROCESSED', { orderNumber: 'X', amount: 125000 }).text, /₹1,25,000\.00/);
  });

  it('says how long a sign-in code lasts (B-03)', () => {
    const { text } = renderNotificationEmail('LOGIN_OTP', { code: '123456', expiresInMinutes: 10 });
    assert.doesNotMatch(text, /in {2}minutes/);
    assert.match(text, /10 minutes/);
  });
});
