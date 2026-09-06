import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Shipment } from '@database/models/shipment.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Order } from '@database/models/order.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { TcsLedger } from '@database/models/tcsLedger.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { AuditLog } from '@database/models/auditLog.model';
import { shippingService } from '@modules/shipping/shipping.service';
import { deliveryAgentsService } from '../deliveryAgents.service';
import { deliveryAgentsRepository } from '../deliveryAgents.repository';
import { returnsService } from '@modules/returns/returns.service';
import { walletService } from '@modules/wallet/wallet.service';
import { notificationsService } from '@modules/notifications/notifications.service';
import { RETURN_STATUS } from '@core/constants/statuses';

describe('Delivery Module Comprehensive Verification', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  describe('shippingService.rescheduleDelivery', () => {
    it('rejects rescheduling when parcel is already RTO_INITIATED or RTO_DELIVERED', async () => {
      mock.method(Shipment, 'findOne', async () => ({
        id: 'shipment-1',
        trackingNumber: 'TRK-RTO-1',
        status: 'RTO_INITIATED',
        subOrder: { order: { userId: 'user-1' } },
      }) as unknown as Shipment);

      await assert.rejects(
        async () => shippingService.rescheduleDelivery('TRK-RTO-1', 'user-1', 'Tomorrow 10am-1pm'),
        /This parcel has exceeded delivery attempts and is being returned to the seller/,
      );
    });

    it('successfully reschedules a FAILED attempt and sets status to IN_TRANSIT', async () => {
      let updatedSlot: string | undefined;
      let updatedStatus: string | undefined;

      mock.method(Shipment, 'findOne', async () => ({
        id: 'shipment-2',
        trackingNumber: 'TRK-FAILED-1',
        status: 'FAILED',
        subOrder: { order: { userId: 'user-1' } },
        update: async (fields: { preferredRedeliverySlot?: string; status?: string }) => {
          updatedSlot = fields.preferredRedeliverySlot;
          updatedStatus = fields.status;
          return this;
        },
      }) as unknown as Shipment);

      await shippingService.rescheduleDelivery('TRK-FAILED-1', 'user-1', 'Tomorrow 2pm-5pm');

      assert.equal(updatedSlot, 'Tomorrow 2pm-5pm');
      assert.equal(updatedStatus, 'IN_TRANSIT');
    });
  });

  describe('RTO Complete Cascade (applyShipmentStatus RTO_DELIVERED)', () => {
    it('updates SubOrder to RETURNED, restocks inventory, destroys commission, and refunds prepaid customer', async () => {
      let subOrderUpdatedStatus: string | undefined;
      let stockIncremented = 0;
      let commissionDestroyed = false;
      let orderUpdatedStatus: string | undefined;
      let walletRefundCredited = 0;

      mock.method(Shipment.prototype, 'update', async function () {
        return this;
      });

      mock.method(SubOrder, 'findByPk', async () => ({
        id: 'suborder-1',
        orderId: 'order-1',
        customerTotal: 1250,
        status: 'SHIPPED',
        items: [{ id: 'item-1', variantId: 'var-1', quantity: 2 }],
        order: {
          id: 'order-1',
          userId: 'user-1',
          paymentMethod: 'RAZORPAY',
          paymentStatus: 'PAID',
        },
        update: async (fields: { status?: string }) => {
          subOrderUpdatedStatus = fields.status;
          return this;
        },
      }) as unknown as SubOrder);

      mock.method(ProductVariant, 'increment', async (_field: string, options: { by?: number }) => {
        stockIncremented += options.by ?? 0;
        return [{}, 1] as any;
      });

      mock.method(CommissionLedger, 'destroy', async () => {
        commissionDestroyed = true;
        return 1;
      });

      mock.method(TcsLedger, 'destroy', async () => 1);

      mock.method(SubOrder, 'findAll', async () => [
        { status: 'RETURNED' },
      ] as unknown as SubOrder[]);

      mock.method(Order, 'findByPk', async () => ({
        id: 'order-1',
        userId: 'user-1',
        paymentMethod: 'RAZORPAY',
        paymentStatus: 'PAID',
      }) as unknown as Order);

      mock.method(Order, 'update', async (fields: { status?: string }) => {
        orderUpdatedStatus = fields.status;
        return [1];
      });

      mock.method(walletService, 'credit', async (_userId, amount) => {
        walletRefundCredited = amount;
        return {} as any;
      });

      mock.method(notificationsService, 'sendRefundProcessed', () => {});

      const mockShipment = {
        id: 'shipment-rto',
        subOrderId: 'suborder-1',
        status: 'RTO_INITIATED',
        update: async function () {
          return this;
        },
      } as unknown as Shipment;

      await shippingService.applyShipmentStatus(mockShipment, 'RTO_DELIVERED');

      assert.equal(subOrderUpdatedStatus, 'RETURNED');
      assert.equal(stockIncremented, 2);
      assert.equal(commissionDestroyed, true);
      assert.equal(orderUpdatedStatus, 'RETURNED');
      assert.equal(walletRefundCredited, 1250);
    });
  });

  describe('returnsService.reschedulePickup', () => {
    it('clears pickupFailureReason when customer picks a new repickup slot', async () => {
      let clearedFailureReason: string | null = 'Customer not home';
      let slotSaved: string | undefined;

      mock.method(ReturnRequest, 'findByPk', async () => ({
        id: 'return-1',
        userId: 'user-1',
        status: RETURN_STATUS.PICKUP_SCHEDULED,
        pickupFailureReason: 'Customer not home',
        update: async (fields: { preferredRepickupSlot?: string; pickupFailureReason?: string | null }) => {
          slotSaved = fields.preferredRepickupSlot;
          clearedFailureReason = fields.pickupFailureReason ?? null;
          return this;
        },
        get: () => ({ id: 'return-1', userId: 'user-1' }),
      }) as unknown as ReturnRequest);

      await returnsService.reschedulePickup('return-1', 'user-1', 'Friday 9am-12pm');

      assert.equal(slotSaved, 'Friday 9am-12pm');
      assert.equal(clearedFailureReason, null);
    });
  });

  describe('deliveryAgentsService.updatePickupStatus', () => {
    it('auto-closes return request after 3 failed pickup attempts', async () => {
      let updatedStatus: string | undefined;
      let rejectionReason: string | undefined;

      const mockReturnId = 'c0000000-0000-0000-0000-000000000001';
      const mockAgentId = 'a0000000-0000-0000-0000-000000000001';
      const mockActorId = 'b0000000-0000-0000-0000-000000000001';
      const mockUserId = 'd0000000-0000-0000-0000-000000000001';

      mock.method(deliveryAgentsRepository, 'assignedPickup', async () => ({
        id: mockReturnId,
        userId: mockUserId,
        status: RETURN_STATUS.PICKUP_SCHEDULED,
        update: async (fields: { status?: string; rejectionReason?: string }) => {
          if (fields.status) updatedStatus = fields.status;
          if (fields.rejectionReason) rejectionReason = fields.rejectionReason;
          return this;
        },
      }) as unknown as ReturnRequest);

      // 2 prior failed attempts logged in AuditLog
      mock.method(AuditLog, 'count', async () => 2);
      mock.method(AuditLog, 'create', async () => ({} as any));
      mock.method(notificationsService, 'sendPickupAttemptFailed', () => {});

      await deliveryAgentsService.updatePickupStatus(mockReturnId, mockAgentId, mockActorId, 'Customer unavailable');

      assert.equal(updatedStatus, RETURN_STATUS.CLOSED);
      assert.match(rejectionReason ?? '', /Closed after 3 failed pickup attempts/);
    });
  });
});
