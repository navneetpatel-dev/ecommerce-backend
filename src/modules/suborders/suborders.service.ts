import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors';
import { SubOrder } from '@database/models/subOrder.model';
import { Vendor } from '@database/models/vendor.model';
import { Order } from '@database/models/order.model';
import { OrderItem } from '@database/models/orderItem.model';
import { Shipment } from '@database/models/shipment.model';
import { DeliveryAgent } from '@database/models/deliveryAgent.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { TcsLedger } from '@database/models/tcsLedger.model';
import { sequelize } from '@database/models';
import { ORDER_STATUS, COMMISSION_STATUS, PAYMENT_STATUS, WALLET_REFERENCE_TYPE } from '@core/constants/statuses';
import { roundMoney } from '@modules/pricing/money';
import { mapSubOrder } from '@modules/orders/orderDisplayMappers';
import { notificationsService } from '@modules/notifications/notifications.service';
import { shippingService } from '@modules/shipping/shipping.service';
import { walletService } from '@modules/wallet/wallet.service';
import { rollbackOrderWalletIfNeeded } from '@modules/wallet/walletOrderRollback';
import type { GetSubOrdersQuery } from './suborders.dto';

/**
 * Transitions reachable through this manual, vendor/admin-facing endpoint.
 * DELIVERED is deliberately absent from every entry — that transition is
 * only reachable through the delivery agent's OTP-gated confirmation
 * (`deliveryAgents.service.ts`'s `confirmDelivery`), never a plain status
 * PATCH, so an order can't be marked delivered without proof the customer
 * actually received it. RETURNED is likewise not settable here — the
 * returns module owns that lifecycle via `ReturnRequest.status`.
 */
const SUBORDER_MANUAL_TRANSITIONS: Record<string, readonly string[]> = {
  [ORDER_STATUS.PENDING]: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.SHIPPED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.CONFIRMED]: [ORDER_STATUS.SHIPPED, ORDER_STATUS.CANCELLED],
};

/** Vendor/admin need to see who's delivering an order, not every internal column. */
const shipmentInclude = {
  model: Shipment,
  as: 'shipment' as const,
  include: [
    {
      model: DeliveryAgent,
      as: 'deliveryAgent' as const,
      attributes: ['id', 'fullName', 'phone'],
    },
  ],
};

/**
 * Read-only visibility into a suborder's return/exchange requests: status and
 * the assigned pickup agent, mirroring `shipmentInclude` above. Vendors can't
 * change return/pickup status here — that lifecycle stays owned by the
 * returns module.
 */
const returnRequestInclude = {
  model: ReturnRequest,
  as: 'returnRequests' as const,
  include: [
    {
      model: DeliveryAgent,
      as: 'deliveryAgent' as const,
      attributes: ['id', 'fullName', 'phone'],
    },
  ],
};

function assertSubOrderTransition(from: string, to: string) {
  if (from === to) return;
  if (!SUBORDER_MANUAL_TRANSITIONS[from]?.includes(to)) {
    throw new ValidationError({ status: [`Cannot move an order from ${from} to ${to} here`] });
  }
}

function mapSubOrderRow(row: SubOrder) {
  const plain = (typeof row.get === 'function'
    ? row.get({ plain: true })
    : row) as Record<string, unknown> & {
    order?: { totalAmount?: unknown; walletAmountUsed?: unknown };
    returnRequests?: unknown[];
  };
  const mapped = mapSubOrder(plain);
  const extra: Record<string, unknown> = {
    // Vendor visibility only — read-only, matches the existing shipment display pattern.
    returnRequests: plain.returnRequests ?? [],
  };
  if (plain.order) {
    extra.order = {
      ...plain.order,
      totalAmount: roundMoney(plain.order.totalAmount),
      walletAmountUsed: roundMoney(plain.order.walletAmountUsed),
    };
  }
  return { ...mapped, ...extra };
}

export class SubordersService {
  async list(vendorId?: string | null, query?: GetSubOrdersQuery) {
    const page = query?.page ?? 1;
    const limit = query?.limit ?? 50;
    const offset = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (vendorId) {
      where.vendorId = vendorId;
    } else if (query?.vendorId) {
      where.vendorId = query.vendorId;
    }
    if (query?.status) {
      where.status = query.status;
    }

    const { rows, count } = await SubOrder.findAndCountAll({
      where,
      include: [
        { model: OrderItem, as: 'items' },
        { model: Order, as: 'order' },
        { model: Vendor, as: 'vendor' },
        shipmentInclude,
        returnRequestInclude,
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
      distinct: true,
      col: 'id',
    });

    const totalPages = Math.ceil(count / limit) || 1;
    return {
      suborders: rows.map(mapSubOrderRow),
      pagination: {
        total: count,
        page,
        limit,
        totalPages,
      },
    };
  }

  async updateStatus(id: string, status: SubOrder['status'], trackingId: string | undefined, updatedBy: string) {
    const suborder = await sequelize.transaction(async (transaction) => {
      // Cancellation locks the parent Order row further down (for the wallet-rollback sentinel
      // and cashback-reduction writes) — acquire that lock FIRST, before the SubOrder row, so the
      // lock order here (Order -> SubOrder) always matches ordersCancel.service.ts's
      // cancelPaidOrder (which locks Order, then implicitly locks SubOrder rows via `.update()`).
      // Locking SubOrder-then-Order here while the other path locks Order-then-SubOrder would be
      // a classic lock-ordering deadlock risk if both run concurrently on the same order.
      if (status === ORDER_STATUS.CANCELLED) {
        const unlockedOrderId = (
          await SubOrder.findByPk(id, { attributes: ['orderId'], transaction })
        )?.orderId;
        if (unlockedOrderId) {
          await Order.findByPk(unlockedOrderId, { transaction, lock: transaction.LOCK.UPDATE });
        }
      }

      const row = await SubOrder.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!row) throw new NotFoundError('SubOrder');
      assertSubOrderTransition(row.status, status);

      await row.update({ status, trackingId: trackingId ?? row.trackingId, updatedBy }, { transaction });

      if (status === ORDER_STATUS.CANCELLED) {
        // 1. Restock items
        const subOrderWithItems = (await SubOrder.findByPk(id, {
          include: [{ model: OrderItem, as: 'items' }],
          transaction,
        })) as (SubOrder & { items?: OrderItem[] }) | null;
        for (const item of subOrderWithItems?.items ?? []) {
          const variantId = (item as any).variantId ?? (item as any).productVariantId;
          if (variantId) {
            await ProductVariant.increment('stock', {
              by: item.quantity,
              where: { id: variantId },
              transaction,
            });
          }
        }

        // 2. Destroy pending CommissionLedger and TcsLedger
        await CommissionLedger.destroy({
          where: { subOrderId: id, status: COMMISSION_STATUS.PENDING },
          transaction,
        });
        await TcsLedger.destroy({
          where: { subOrderId: id },
          transaction,
        });

        // 3. Customer wallet refund if prepaid / paid
        const parentOrder = await Order.findByPk(row.orderId, {
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        const refundAmount = Number(row.customerTotal ?? row.subtotal);
        if (
          parentOrder &&
          parentOrder.paymentStatus === PAYMENT_STATUS.PAID &&
          refundAmount > 0
        ) {
          await walletService.credit(
            parentOrder.userId,
            refundAmount,
            { type: WALLET_REFERENCE_TYPE.WALLET_REFUND, id: id },
            `Refund for cancelled suborder #${id.slice(0, 8).toUpperCase()}`,
            transaction,
          );
        }

        // Note: pendingCashbackAmount is deliberately NOT shrunk here. It stays frozen at its
        // checkout-time (whole-cart) value; cashback.service.ts's creditPendingCashbackForOrder
        // prorates it against whichever suborders actually deliver at the moment of crediting.
        // (An earlier version of this fix tried to shrink it incrementally on each cancellation,
        // but that compounds against the already-shrunk running balance across sequential partial
        // cancellations, under-reducing it — computing the prorated amount fresh at credit time
        // from the immutable merchandiseSubtotal/subtotal figures avoids that entirely.)

        // 4. Settle parent order if all suborders are now cancelled
        if (parentOrder) {
          const sisterSubOrders = await SubOrder.findAll({
            where: { orderId: parentOrder.id },
            attributes: ['id', 'status'],
            transaction,
          });
          const allCancelled = sisterSubOrders.every(
            (s) => s.id === id || s.status === ORDER_STATUS.CANCELLED,
          );
          if (allCancelled) {
            // Also roll back the checkout-time wallet spend here (writing the same rollback
            // sentinel `cancelPaidOrder` checks for) and zero `walletAmountUsed` — otherwise a
            // later order-level cancel call on this same now-CANCELLED order finds no sentinel
            // and issues a second wallet credit for the full amount already refunded above.
            await rollbackOrderWalletIfNeeded(parentOrder, parentOrder.userId, transaction);
            await Order.update(
              {
                status: ORDER_STATUS.CANCELLED,
                walletAmountUsed: 0,
                // Every suborder is cancelled — nothing will ever deliver, so no cashback is due.
                pendingCashbackAmount: 0,
              },
              { where: { id: parentOrder.id }, transaction },
            );
          }
        }
      }

      if (status === ORDER_STATUS.SHIPPED && trackingId) {
        const parentOrder = await Order.findByPk(row.orderId, {
          transaction,
          attributes: ['paymentMethod'],
        });
        const codAmount =
          parentOrder?.paymentMethod === 'COD' ? Number(row.customerTotal ?? row.subtotal) : null;
        const [shipment, created] = await Shipment.findOrCreate({
          where: { subOrderId: id },
          defaults: {
            subOrderId: id,
            carrier: 'MANUAL',
            trackingNumber: trackingId,
            status: 'IN_TRANSIT',
            shippedAt: new Date(),
            codAmount,
          } as never,
          transaction,
        });
        if (!created) {
          await shippingService.applyShipmentStatus(
            shipment,
            'IN_TRANSIT',
            { trackingNumber: trackingId, carrier: shipment.carrier ?? 'MANUAL' },
            transaction,
          );
        }
      }
      return row.reload({
        include: [
          { model: Order, as: 'order' },
          { model: OrderItem, as: 'items' },
          {
            model: Shipment,
            as: 'shipment',
            include: [{ model: DeliveryAgent, as: 'deliveryAgent' }],
          },
          returnRequestInclude,
        ],
        transaction,
      });
    });

    const order = (suborder as SubOrder & { order?: Order }).order;
    if (order?.userId) {
      const orderNumber = order.id.slice(0, 8).toUpperCase();
      if (status === ORDER_STATUS.SHIPPED) {
        void notificationsService.sendSubOrderShipped(order.userId, suborder.id, {
          orderId: order.id,
          orderNumber,
          trackingId: suborder.trackingId,
        });
      }
      if (status === ORDER_STATUS.DELIVERED) {
        void notificationsService.sendSubOrderDelivered(order.userId, suborder.id, {
          orderId: order.id,
          orderNumber,
        });
      }
      if (status === ORDER_STATUS.CANCELLED) {
        void notificationsService.sendOrderCancelled(order.userId, order.id, {
          orderId: order.id,
          orderNumber,
        });
      }
    }

    return mapSubOrderRow(suborder);
  }
}

export const subordersService = new SubordersService();
