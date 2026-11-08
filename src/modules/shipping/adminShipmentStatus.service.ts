import { Op } from 'sequelize';
import { sequelize } from '@database/models';
import { Shipment } from '@database/models/shipment.model';
import { ShipmentAttempt } from '@database/models/shipmentAttempt.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Order } from '@database/models/order.model';
import { Address } from '@database/models/address.model';
import { OrderItem } from '@database/models/orderItem.model';
import { User } from '@database/models/user.model';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { logAudit } from '@modules/audit/audit.service';
import type { AdminShipmentStatus } from './shipping.dto';
import { SHIPMENT_STATUS_TRANSITIONS, shippingService } from './shipping.service';

/** Admin hand-moves of a shipment, and the queue of parcels returning to the seller. */
export const adminShipmentStatusService = {
  /**
   * An admin moves a shipment on by hand — the same path a carrier webhook takes, for a
   * carrier that reports nothing (or none configured): out for delivery, delivered, a
   * failed attempt, returned to origin (RTO) and received back. A COD delivery says
   * whether the cash was collected, so the order is only marked paid for money taken. A
   * failed attempt records its reason in the shipment's attempt history; the third one
   * starts the RTO, as a carrier's would.
   */
  async updateStatus(
    shipmentId: string,
    actorId: string,
    input: { status: AdminShipmentStatus; reason?: string; codCollected?: boolean },
  ): Promise<Shipment> {
    const updated = await sequelize.transaction(async (transaction) => {
      const shipment = await Shipment.findByPk(shipmentId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!shipment) throw new NotFoundError('Shipment');
      const from = shipment.status;
      if (!SHIPMENT_STATUS_TRANSITIONS[from]?.includes(input.status)) {
        throw new ValidationError({ status: [`Cannot move a shipment from ${from} to ${input.status}`] });
      }
      const reason = input.reason?.trim() || null;
      if (input.status === 'FAILED' && !reason) {
        throw new ValidationError({ reason: ['Give the reason the delivery attempt failed'] });
      }
      const isCod = shipment.codAmount != null;
      if (input.status === 'DELIVERED' && isCod && input.codCollected == null) {
        throw new ValidationError({ codCollected: ['Say whether the cash on delivery was collected'] });
      }
      const extra: Partial<Shipment> = {
        updatedBy: actorId,
        ...(input.status === 'FAILED' ? { failureReason: reason } : {}),
        ...(input.status === 'RTO_DELIVERED' ? { rtoConfirmedAt: new Date() } : {}),
        ...(input.status === 'DELIVERED' && isCod
          ? { codCollected: Boolean(input.codCollected), codCollectedAt: input.codCollected ? new Date() : null }
          : {}),
      };
      const priorFailed = Number(shipment.failedAttemptCount ?? 0);
      await shippingService.applyShipmentStatus(shipment, input.status, extra, transaction);
      if (input.status === 'FAILED') {
        await ShipmentAttempt.create(
          {
            shipmentId: shipment.id,
            attemptNumber: priorFailed + 1,
            note: reason!,
            photoUrl: null,
            attemptedAt: new Date(),
            createdBy: actorId,
          },
          { transaction },
        );
      }
      await logAudit({
        actorId,
        action: 'SHIPMENT_STATUS_UPDATED',
        entityType: 'Shipment',
        entityId: shipment.id,
        metadata: {
          from,
          to: shipment.status,
          ...(reason ? { reason } : {}),
          ...(input.status === 'DELIVERED' && isCod ? { codCollected: Boolean(input.codCollected) } : {}),
        },
        transaction,
      });
      return shipment;
    });
    return updated;
  },

  /** Parcels coming back to the seller (RTO), newest failed attempt first, for the admin queue. */
  async rtoQueue(): Promise<Shipment[]> {
    return Shipment.findAll({
      where: { status: { [Op.in]: ['RTO_INITIATED', 'RTO_DELIVERED'] } },
      include: [
        {
          model: SubOrder,
          as: 'subOrder',
          include: [
            {
              model: Order,
              as: 'order',
              include: [
                { model: Address, as: 'shippingAddress' },
                { model: User, as: 'user', attributes: ['id', 'name', 'email', 'phone'] },
              ],
            },
            { model: OrderItem, as: 'items' },
          ],
        },
      ],
      order: [['lastFailedAttemptAt', 'DESC']],
      limit: 100,
    });
  },
};
