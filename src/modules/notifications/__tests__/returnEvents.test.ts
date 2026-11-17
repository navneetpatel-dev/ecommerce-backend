import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { OrderItem } from '@database/models/orderItem.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Order } from '@database/models/order.model';
import { User } from '@database/models/user.model';
import { Role } from '@database/models/role.model';
import { notificationsService } from '../notifications.service';
import { notifyReturnRequestedEvent, notifyReturnStatus } from '../events/returnEvents';

type Row = Record<string, any>;

function stubReturn() {
  mock.method(ReturnRequest, 'findByPk', async () => ({ id: 'r1', orderItemId: 'i1', subOrderId: 's1', reason: 'Item not as described', returnQuantity: 1 }) as never);
  mock.method(OrderItem, 'findByPk', async () => ({ productName: 'Headphones', quantity: 1 }) as never);
  mock.method(SubOrder, 'findByPk', async () => ({ id: 's1', orderId: 'abcd1234-0000', vendorId: 'v1' }) as never);
  mock.method(Order, 'findByPk', async () => ({ id: 'abcd1234-0000', userId: 'customer-1' }) as never);
  mock.method(Role, 'findOne', async () => ({ id: 'role' }) as never);
  mock.method(User, 'findOne', async () => ({ id: 'seller-1' }) as never);
  mock.method(User, 'findAll', async () => [] as never);
  const sent: Row[] = [];
  mock.method(notificationsService, 'enqueue', async (params: Row) => {
    sent.push(params);
    return null as never;
  });
  return sent;
}

describe('return emails', () => {
  afterEach(() => mock.restoreAll());

  it('sends the shopper a stage-specific email for each return status', async () => {
    const sent = stubReturn();
    for (const status of ['APPROVED', 'REJECTED', 'PICKUP_SCHEDULED', 'RECEIVED']) await notifyReturnStatus('r1', status, status === 'REJECTED' ? 'Used item' : null);
    assert.deepEqual(sent.map((mail) => mail.type), ['RETURN_APPROVED', 'RETURN_REJECTED', 'RETURN_PICKUP_SCHEDULED', 'RETURN_RECEIVED']);
    assert.ok(sent.every((mail) => mail.userId === 'customer-1'));
    assert.equal(sent[1]!.templateData.reason, 'Used item');
    assert.equal(sent[0]!.templateData.orderNumber, 'ABCD1234');
  });

  it('ignores statuses that have no email', async () => {
    const sent = stubReturn();
    await notifyReturnStatus('r1', 'SOMETHING_ELSE');
    assert.equal(sent.length, 0);
  });

  it('confirms to the shopper and asks the seller to review a new request (not the shopper-worded email)', async () => {
    const sent = stubReturn();
    await notifyReturnRequestedEvent('r1');
    assert.deepEqual(sent.map((mail) => [mail.type, mail.userId]), [['RETURN_REQUESTED', 'customer-1'], ['VENDOR_RETURN_REQUESTED', 'seller-1']]);
    assert.equal(sent[1]!.templateData.details[0].value, 'Headphones × 1');
  });
});
