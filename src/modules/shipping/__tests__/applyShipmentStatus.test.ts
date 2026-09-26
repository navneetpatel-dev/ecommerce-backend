import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { sequelize } from '@database/models';
import { Shipment } from '@database/models/shipment.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Order } from '@database/models/order.model';
import { shippingService } from '../shipping.service';
import { deliveryAgentPayoutsService } from '@modules/deliveryAgents/deliveryAgentPayouts.service';
import { notificationsService } from '@modules/notifications/notifications.service';
import { PAYMENT_STATUS } from '@core/constants/statuses';

describe('applyShipmentStatus idempotency (F-17)', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  function stubTransaction() {
    mock.method(sequelize, 'transaction', async (callback: (t: unknown) => Promise<unknown>) => {
      return callback({ LOCK: { UPDATE: 'UPDATE' } });
    });
  }

  it('no-ops a duplicate DELIVERED without re-running the cascade', async () => {
    stubTransaction();
    let updateCount = 0;
    let subOrderUpdateCount = 0;
    let earningCount = 0;

    mock.method(SubOrder, 'update', async () => {
      subOrderUpdateCount += 1;
      return [1];
    });
    mock.method(deliveryAgentPayoutsService, 'recordEarning', async () => {
      earningCount += 1;
      return null;
    });

    const shipment = {
      id: 'shipment-1',
      subOrderId: 'sub-1',
      status: 'DELIVERED',
      deliveryAgentId: 'agent-1',
      codAmount: 500,
      update: async () => {
        updateCount += 1;
        return shipment;
      },
    } as unknown as Shipment;

    await shippingService.applyShipmentStatus(shipment, 'DELIVERED');

    assert.equal(updateCount, 0);
    assert.equal(subOrderUpdateCount, 0);
    assert.equal(earningCount, 0);
  });

  it('ignores an out-of-order OUT_FOR_DELIVERY webhook after DELIVERED', async () => {
    stubTransaction();
    let updateCount = 0;
    const shipment = {
      id: 'shipment-2',
      subOrderId: 'sub-2',
      trackingNumber: 'TRK-1',
      status: 'DELIVERED',
      update: async () => {
        updateCount += 1;
        return shipment;
      },
    } as unknown as Shipment;

    mock.method(Shipment, 'findOne', async () => shipment);

    await shippingService.processWebhook('TRK-1', 'OUT_FOR_DELIVERY');

    assert.equal(shipment.status, 'DELIVERED');
    assert.equal(updateCount, 0);
  });

  it('settles COD and records agent earning once on a webhook-only DELIVERED transition', async () => {
    stubTransaction();
    let earningCount = 0;
    let orderPaid = false;
    let notifyCount = 0;

    mock.method(deliveryAgentPayoutsService, 'recordEarning', async () => {
      earningCount += 1;
      return null;
    });
    mock.method(notificationsService, 'sendSubOrderDelivered', () => {
      notifyCount += 1;
    });
    mock.method(SubOrder, 'update', async () => [1]);
    mock.method(SubOrder, 'findByPk', async () => ({
      id: 'sub-3',
      orderId: 'order-3',
      status: 'SHIPPED',
      // Issued when it shipped (pricing/taxInvoiceIssue); delivery keeps it.
      taxInvoiceNumber: 'INK/2627/00000001',
    }));
    mock.method(SubOrder, 'findAll', async () => [{ status: 'DELIVERED' }]);
    mock.method(Order, 'update', async () => [1]);

    const order = {
      id: 'order-3',
      paymentMethod: 'COD',
      paymentStatus: PAYMENT_STATUS.PENDING,
      userId: 'user-1',
      update: async (fields: { paymentStatus?: string }) => {
        if (fields.paymentStatus === PAYMENT_STATUS.PAID) orderPaid = true;
        return order;
      },
    };
    mock.method(Order, 'findByPk', async () => order);

    const shipment = {
      id: 'shipment-3',
      subOrderId: 'sub-3',
      status: 'OUT_FOR_DELIVERY',
      deliveryAgentId: 'agent-3',
      codAmount: 750,
      codCollected: false,
      update: async function update(this: { status: string; codCollected: boolean }, fields: { status?: string; codCollected?: boolean }) {
        if (fields.status) this.status = fields.status;
        if (fields.codCollected) this.codCollected = true;
        return this;
      },
    };

    mock.method(Shipment, 'findAll', async () => [shipment]);

    await shippingService.applyShipmentStatus(shipment as unknown as Shipment, 'DELIVERED');

    assert.equal(shipment.status, 'DELIVERED');
    assert.equal(earningCount, 1);
    assert.equal(orderPaid, true);
    assert.equal(notifyCount, 1);

    await shippingService.applyShipmentStatus(shipment as unknown as Shipment, 'DELIVERED');
    assert.equal(earningCount, 1);
    assert.equal(notifyCount, 1);
  });
});
