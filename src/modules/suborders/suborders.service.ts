import { Op } from 'sequelize';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { assertPartPaidFor, assertSubOrderTransition } from './subOrderTransitions';
import { recordPartShipment } from './partShipment';
import { User } from '@database/models/user.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Order } from '@database/models/order.model';
import { OrderItem } from '@database/models/orderItem.model';
import { Shipment } from '@database/models/shipment.model';
import { restoreStock } from '@modules/inventory/restoreStock';
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
  orderRazorpayPaidPaise,
  walletShareOfRefundPaise,
} from '@modules/pricing/refundSplit';
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
import { destroyCouponUsageForOrder, destroyCouponUsageForVendorPart } from '@modules/coupons/couponEngine';
import { isReversedPart } from '@modules/pricing/partReversal';
import { orderReference } from '@modules/orders/orderReference';
import { buildOrderEmailData } from '@modules/notifications/orderEmailData';
import { notifySubOrderDelivered } from '@modules/notifications/events/orderEvents';
import {
  returnRequestInclude,
  suborderCancelCashShare,
  mapSubOrderRow,
  suborderListIncludes,
} from './suborderInclude';

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
    if (query?.search?.trim()) {
      const clean = query.search.trim().replace(/^#/, '');
      const q = `%${clean}%`;
      const esc = sequelize.escape(q);
      const searchConditions = [
        `"SubOrder"."id"::text ILIKE ${esc}`,
        `"SubOrder"."taxInvoiceNumber" ILIKE ${esc}`,
        `EXISTS (SELECT 1 FROM order_items oi WHERE oi."subOrderId" = "SubOrder"."id" AND (oi."productName" ILIKE ${esc} OR oi."sku" ILIKE ${esc}))`,
        `EXISTS (SELECT 1 FROM shipments sh WHERE sh."subOrderId" = "SubOrder"."id" AND sh."trackingNumber" ILIKE ${esc})`,
        `EXISTS (SELECT 1 FROM orders o WHERE o."id" = "SubOrder"."orderId" AND o."id"::text ILIKE ${esc})`,
      ];
      (where as any)[Op.and] = [sequelize.literal(`(${searchConditions.join(' OR ')})`)];
    }

    const effectiveVendorId = vendorId || query?.vendorId;
    const { rows, count } = await SubOrder.findAndCountAll({
      where,
      include: suborderListIncludes(effectiveVendorId),
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

  async updateStatus(
    id: string,
    status: SubOrder['status'],
    trackingId: string | undefined,
    updatedBy: string,
    cancellationReason?: string,
    cancelledByRole?: string,
  ) {
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
      if (status === ORDER_STATUS.SHIPPED && !trackingId?.trim() && !row.trackingId) {
        throw new ValidationError({ trackingId: ['Tracking number is required to ship an order'] });
      }
      assertPartPaidFor(
        await Order.findByPk(row.orderId, { attributes: ['paymentMethod', 'paymentStatus'], transaction }),
      );
      // Who moved the part, and from what: a cancel here restocks and refunds.
      await logAudit({
        actorId: updatedBy,
        action: 'SUBORDER_STATUS_UPDATED',
        entityType: 'SubOrder',
        entityId: id,
        metadata: {
          previousStatus: row.status,
          newStatus: status,
          trackingId: trackingId ?? null,
          cancellationReason: cancellationReason ?? null,
          cancelledByRole: cancelledByRole ?? null,
        },
        transaction,
      });

      const patchData: Record<string, unknown> = {
        status,
        trackingId: trackingId ?? row.trackingId,
        updatedBy,
      };
      if (status === ORDER_STATUS.CANCELLED) {
        patchData.cancellationReason = cancellationReason ?? row.cancellationReason;
        patchData.cancelledByRole = cancelledByRole ?? 'VENDOR';
      }
      await row.update(patchData, { transaction });
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
            await restoreStock(variantId, item.quantity, transaction);
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
            // That vendor's own coupon applied to nothing left on this order: its use comes back.
            if (row.vendorId) {
              await destroyCouponUsageForVendorPart(parentOrder.id, row.vendorId, transaction);
            }
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
          { model: Shipment, as: 'shipment' },
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
      const orderNumber = orderReference(order.id);
      if (status === ORDER_STATUS.SHIPPED) {
        // The tax invoice is issued at dispatch, so the shipped email is the one that carries it.
        void buildOrderEmailData(order.id, { subOrderId: suborder.id, withAddress: true }).then((rich) =>
          notificationsService.sendSubOrderShipped(
            order.userId,
            suborder.id,
            { orderId: order.id, orderNumber, trackingId: suborder.trackingId, ...rich },
            [{ kind: 'taxInvoice', subOrderId: suborder.id }],
          ),
        );
      }
      if (status === ORDER_STATUS.DELIVERED) {
        void notifySubOrderDelivered(order.id, suborder.id);
      }
      if (status === ORDER_STATUS.CANCELLED) {
        // The whole order only once its last part goes: an "order cancelled" email for one
        // vendor's part misled, and then blocked the real one.
        const notify = orderFullyCancelled
          ? notificationsService.sendOrderCancelled(order.userId, order.id, { orderId: order.id, orderNumber })
          : notificationsService.sendSubOrderCancelled(order.userId, suborder.id, { orderId: order.id, orderNumber });
        void notify;

        if (cancelledByRole !== 'VENDOR' && suborder.vendorId) {
          void User.findAll({
            where: { vendorId: suborder.vendorId },
            attributes: ['id'],
          }).then((vendorUsers) => {
            for (const vUser of vendorUsers) {
              void notificationsService.sendVendorOrderCancelled(vUser.id, suborder.id, {
                orderId: order.id,
                orderNumber,
                subOrderId: suborder.id,
                cancelledBy: cancelledByRole === 'ADMIN' ? 'the marketplace team' : 'the customer',
              });
            }
          }).catch(() => {
            // Non-critical notification failure logged by service
          });
        }
      }
    }

    return mapSubOrderRow(suborder);
  }
}

export const subordersService = new SubordersService();
