import { NotFoundError } from '@core/errors/NotFoundError';
import { assertPartPaidFor, assertSubOrderTransition, VENDOR_VISIBLE_ORDER_WHERE } from './subOrderTransitions';
import { recordPartShipment } from './partShipment';
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
import {
  ORDER_STATUS,
  COMMISSION_STATUS,
  PAYMENT_STATUS,
  PAYMENT_METHOD,
  REFUND_STATUS,
  WALLET_REFERENCE_TYPE,
} from '@core/constants/statuses';
import { fromPaise, roundMoney, sumRupees, toPaise } from '@modules/pricing/money';
import {
  isWalletFundedOrder,
  orderRazorpayPaidPaise,
  walletShareOfRefundPaise,
} from '@modules/pricing/refundSplit';
import { mapSubOrder } from '@modules/orders/orderDisplayMappers';
import { notificationsService } from '@modules/notifications/notifications.service';
import { settleCodPaymentIfComplete } from '@modules/shipping/codSettlement';
import { rollUpOrderStatus } from '@modules/orders/orderStatusRollup';
import { logAudit } from '@modules/audit/audit.service';
import { issuePartCardRefund, markPartCardRefundPending } from '@modules/payments/partCardRefund';
import { walletService } from '@modules/wallet/wallet.service';
import { WALLET_DESCRIPTIONS } from '@modules/wallet/wallet.constants';
import {
  returnWalletShareForCancelledPart,
  rollbackOrderWalletIfNeeded,
} from '@modules/wallet/walletOrderRollback';
import type { GetSubOrdersQuery } from './suborders.dto';
import { issueTaxInvoicesOnDispatch } from '@modules/pricing/taxInvoiceIssue';
import { destroyCouponUsageForOrder } from '@modules/coupons/couponEngine';
import { isReversedPart } from '@modules/pricing/partReversal';

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

/**
 * Non-wallet (cash/Razorpay/COD) share of a suborder refund. The wallet-funded share
 * goes back to the wallet as the checkout spend it was (returnWalletShareForCancelledPart,
 * or rollbackOrderWalletIfNeeded for the last part) — never as a WALLET_REFUND. The
 * split itself is the one returns use (pricing/refundSplit).
 */
function suborderCancelCashShare(order: Order, customerRefund: number): number {
  if (isWalletFundedOrder(order)) return 0;
  const refundPaise = toPaise(customerRefund);
  return fromPaise(refundPaise - walletShareOfRefundPaise(order, refundPaise));
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
        // A vendor never sees a checkout still awaiting payment: nothing to do on it yet.
        vendorId
          ? { model: Order, as: 'order', where: VENDOR_VISIBLE_ORDER_WHERE, required: true }
          : { model: Order, as: 'order' },
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
    let razorpayDue = 0;
    let razorpayPaymentId: string | null = null;
    let refundOrderId: string | null = null;
    let orderFullyCancelled = false;

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
      assertPartPaidFor(
        await Order.findByPk(row.orderId, { attributes: ['paymentMethod', 'paymentStatus'], transaction }),
      );
      // Who moved the part, and from what: a cancel here restocks and refunds.
      await logAudit({
        actorId: updatedBy,
        action: 'SUBORDER_STATUS_UPDATED',
        entityType: 'SubOrder',
        entityId: id,
        metadata: { previousStatus: row.status, newStatus: status, trackingId: trackingId ?? null },
        transaction,
      });

      await row.update({ status, trackingId: trackingId ?? row.trackingId, updatedBy }, { transaction });
      if (status === ORDER_STATUS.SHIPPED || status === ORDER_STATUS.DELIVERED) {
        await issueTaxInvoicesOnDispatch(id, transaction);
        await rollUpOrderStatus(row.orderId, transaction);
      }

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

        // 3. Customer refund: this part's wallet share goes back as checkout spend (the last
        // part via rollbackOrderWalletIfNeeded, the sentinel `cancelPaidOrder` uses). Never
        // credit the gross suborder total as WALLET_REFUND — that double-credits the wallet share.
        const parentOrder = await Order.findByPk(row.orderId, {
          transaction,
          lock: transaction.LOCK.UPDATE,
        });

        // Note: pendingCashbackAmount is deliberately NOT shrunk here. It stays frozen at its
        // checkout-time (whole-cart) value; cashback.service.ts's creditPendingCashbackForOrder
        // prorates it against whichever suborders actually deliver at the moment of crediting.
        // (An earlier version of this fix tried to shrink it incrementally on each cancellation,
        // but that compounds against the already-shrunk running balance across sequential partial
        // cancellations, under-reducing it — computing the prorated amount fresh at credit time
        // from the immutable merchandiseSubtotal/subtotal figures avoids that entirely.)

        if (parentOrder) {
          const sisterSubOrders = await SubOrder.findAll({
            where: { orderId: parentOrder.id },
            attributes: ['id', 'status', 'customerTotal', 'subtotal'],
            transaction,
          });
          // Every other part is already reversed (cancelled, or RTO'd): this is the last.
          const allCancelled = sisterSubOrders.every(
            (s) => s.id === id || isReversedPart(s.status),
          );
          const customerRefund = roundMoney(Number(row.customerTotal ?? row.subtotal));
          if (allCancelled) {
            // Whatever wallet spend earlier part cancellations did not already return.
            await rollbackOrderWalletIfNeeded(parentOrder, parentOrder.userId, transaction);
          } else {
            // This part's wallet share goes back now; its cash share is refunded below.
            await returnWalletShareForCancelledPart(
              parentOrder,
              id,
              walletShareOfRefundPaise(parentOrder, toPaise(customerRefund)),
              parentOrder.userId,
              transaction,
            );
          }

          if (
            parentOrder.paymentStatus === PAYMENT_STATUS.PAID &&
            customerRefund > 0
          ) {
            let cashShare: number;
            if (allCancelled && sisterSubOrders.length === 1) {
              cashShare = fromPaise(orderRazorpayPaidPaise(parentOrder));
            } else {
              cashShare = suborderCancelCashShare(parentOrder, customerRefund);
              if (parentOrder.paymentMethod !== PAYMENT_METHOD.COD) {
                const razorpayPaid = fromPaise(orderRazorpayPaidPaise(parentOrder));
                const alreadyRefunded = sumRupees(
                  sisterSubOrders
                    .filter((s) => s.id !== id && isReversedPart(s.status))
                    .map((s) =>
                      suborderCancelCashShare(
                        parentOrder,
                        roundMoney(Number(s.customerTotal ?? s.subtotal)),
                      ),
                    ),
                );
                const remaining = roundMoney(Math.max(0, razorpayPaid - alreadyRefunded));
                // The last cancellation returns everything Razorpay still holds, which
                // includes order-level charges no sub-order carries (the gift-wrap fee).
                cashShare = allCancelled ? remaining : roundMoney(Math.min(cashShare, remaining));
              }
            }

            if (cashShare > 0) {
              if (parentOrder.paymentMethod === PAYMENT_METHOD.COD) {
                await walletService.credit(
                  parentOrder.userId,
                  cashShare,
                  { type: WALLET_REFERENCE_TYPE.COD_REFUND, id },
                  WALLET_DESCRIPTIONS.COD_REFUND,
                  transaction,
                );
              } else if (parentOrder.razorpayPaymentId) {
                razorpayDue = cashShare;
                razorpayPaymentId = parentOrder.razorpayPaymentId;
                refundOrderId = parentOrder.id;
                await markPartCardRefundPending(id, toPaise(cashShare), transaction);
              }
            }
          }

          if (allCancelled) {
            const paidNoGatewayRefund =
              parentOrder.paymentStatus === PAYMENT_STATUS.PAID && !razorpayPaymentId;
            await Order.update(
              {
                status: ORDER_STATUS.CANCELLED,
                walletAmountUsed: 0,
                // Every suborder is cancelled — nothing will ever deliver, so no cashback is due.
                pendingCashbackAmount: 0,
                ...(razorpayPaymentId
                  ? { cancelRefundStatus: REFUND_STATUS.PENDING }
                  : paidNoGatewayRefund
                    ? {
                        paymentStatus: PAYMENT_STATUS.REFUNDED,
                        cancelRefundStatus: REFUND_STATUS.COMPLETED,
                      }
                    : {}),
              },
              { where: { id: parentOrder.id }, transaction },
            );
            // Cancelled part by part, the order ends where a whole-order cancel does: give the
            // coupon redemptions back (usage limits, analytics). Not when a part came back
            // undelivered (RTO) — a refused parcel does not return the coupon.
            if (sisterSubOrders.every((s) => s.id === id || s.status === ORDER_STATUS.CANCELLED)) {
              await destroyCouponUsageForOrder(parentOrder.id, transaction);
            }
            orderFullyCancelled = true;
          } else {
            // The rest may all be shipped or delivered already: the order follows them.
            await rollUpOrderStatus(parentOrder.id, transaction);
            // The other parcels may all be delivered and paid: with this, the last part
            // still owed, cancelled, the order is paid in full.
            if (parentOrder.paymentMethod === PAYMENT_METHOD.COD) {
              await settleCodPaymentIfComplete(id, transaction);
            }
          }
        }
      }

      if (status === ORDER_STATUS.SHIPPED && trackingId) {
        await recordPartShipment(id, row.orderId, trackingId, transaction);
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

    if (razorpayPaymentId && razorpayDue > 0 && refundOrderId) {
      await issuePartCardRefund({
        orderId: refundOrderId,
        subOrderId: id,
        paymentId: razorpayPaymentId,
        amountPaise: toPaise(razorpayDue),
        lastPart: orderFullyCancelled,
      });
    }

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
        // The whole order only once its last part goes: an "order cancelled" email for one
        // vendor's part misled, and then blocked the real one.
        const notify = orderFullyCancelled
          ? notificationsService.sendOrderCancelled(order.userId, order.id, { orderId: order.id, orderNumber })
          : notificationsService.sendSubOrderCancelled(order.userId, suborder.id, { orderId: order.id, orderNumber });
        void notify;
      }
    }

    return mapSubOrderRow(suborder);
  }
}

export const subordersService = new SubordersService();
