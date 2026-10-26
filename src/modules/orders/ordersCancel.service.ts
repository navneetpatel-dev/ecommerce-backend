import { NotFoundError } from '@core/errors/NotFoundError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ValidationError } from '@core/errors/ValidationError';
import { sequelize } from '@database/models';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { OrderItem } from '@database/models/orderItem.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { TcsLedger } from '@database/models/tcsLedger.model';
import {
  ORDER_STATUS,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  COMMISSION_STATUS,
  REFUND_STATUS,
  allSubOrdersCancellable,
} from '@core/constants/statuses';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { cartService } from '@modules/cart/cart.service';
import { destroyCouponUsageForOrder } from '@modules/coupons/couponEngine';
import { paymentsService } from '@modules/payments/payments.service';
import { fromPaise, toPaise } from '@modules/pricing/money';
import { orderRazorpayPaidPaise } from '@modules/pricing/refundSplit';
import { rollbackOrderWalletIfNeeded } from '@modules/wallet/walletOrderRollback';
import { notificationsService } from '@modules/notifications/notifications.service';
import { logAudit } from '@modules/audit/audit.service';
import { failedOrderRefundAttempt } from '@modules/payments/orderCancelRefund';
import { subordersService } from '@modules/suborders/suborders.service';
import { isReversedPart } from '@modules/pricing/partReversal';

type OrderForCancel = Order & {
  subOrders?: (SubOrder & { items?: OrderItem[] })[];
};

export async function cancelPaidOrder(
  orderId: string,
  userId: string,
  isAdmin: boolean,
): Promise<{ orderId: string; cancelled: boolean }> {
  let cancelledOrderId: string | null = null;
  let razorpayDue = 0;
  let razorpayPaymentId: string | null = null;
  let alreadyCancelled = false;
  let remainingPartIds: string[] = [];

  await sequelize.transaction(async (t) => {
    const locked = await Order.findByPk(orderId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!locked) throw new NotFoundError('Order');
    if (!isAdmin && locked.userId !== userId) {
      throw new ForbiddenError(ERROR_MESSAGES.NO_ACCESS_TO_ORDER);
    }
    // A COD order is unpaid until delivery, and its customer may cancel it before it
    // ships too. An unpaid online order is an abandoned checkout, cancelled elsewhere.
    if (
      !isAdmin &&
      locked.paymentStatus !== PAYMENT_STATUS.PAID &&
      locked.paymentMethod !== PAYMENT_METHOD.COD
    ) {
      throw new ValidationError(ERROR_MESSAGES.ORDER_CANCEL_PAID_ONLY);
    }
    if (locked.status === ORDER_STATUS.CANCELLED) {
      const walletRestored = await rollbackOrderWalletIfNeeded(locked, locked.userId, t);
      if (walletRestored) {
        await locked.update({ walletAmountUsed: 0 }, { transaction: t });
      }
      cancelledOrderId = locked.id;
      alreadyCancelled = true;
      return;
    }
    if (
      [ORDER_STATUS.SHIPPED, ORDER_STATUS.DELIVERED, ORDER_STATUS.RETURNED].includes(
        locked.status as typeof ORDER_STATUS.SHIPPED,
      )
    ) {
      throw new ValidationError(ERROR_MESSAGES.ORDER_CANCEL_SHIPPED);
    }

    // Lock the parts before reading their status: a vendor ships a part by locking only
    // its SubOrder row, so without this a part shipped while we waited on the Order lock
    // would still read CONFIRMED here and be overwritten to CANCELLED — refunded and
    // restocked while the parcel is on its way. Same id order as every other part lock.
    await SubOrder.findAll({
      where: { orderId },
      attributes: ['id'],
      order: [['id', 'ASC']],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    const orderResult = await Order.findByPk(orderId, {
      include: [
        {
          model: SubOrder,
          as: 'subOrders',
          include: [{ model: OrderItem, as: 'items' }],
        },
      ],
      transaction: t,
    });
    if (!orderResult) throw new NotFoundError('Order');
    const order = orderResult as OrderForCancel;

    razorpayDue = fromPaise(orderRazorpayPaidPaise(order));
    razorpayPaymentId = order.razorpayPaymentId;

    // Part of the order was cancelled already: what the customer gets back is the rest's
    // share, which the part cancellation works out (and the last part settles the order).
    // So the remaining parts are cancelled that way, after this transaction.
    const parts = order.subOrders ?? [];
    const liveParts = parts.filter((part) => !isReversedPart(part.status));
    if (liveParts.length > 0 && liveParts.length < parts.length) {
      if (!allSubOrdersCancellable(liveParts)) {
        throw new ValidationError(ERROR_MESSAGES.ORDER_CANCEL_ITEMS_SHIPPED);
      }
      remainingPartIds = liveParts.map((part) => part.id);
      return;
    }

    if (!allSubOrdersCancellable(parts)) {
      throw new ValidationError(ERROR_MESSAGES.ORDER_CANCEL_ITEMS_SHIPPED);
    }

    const restoreLines: Array<{ variantId: string; quantity: number }> = [];
    for (const subOrder of order.subOrders ?? []) {
      for (const item of subOrder.items ?? []) {
        restoreLines.push({ variantId: item.variantId, quantity: item.quantity });
        await ProductVariant.increment('stock', {
          by: item.quantity,
          where: { id: item.variantId },
          transaction: t,
        });
      }
      await subOrder.update({ status: ORDER_STATUS.CANCELLED }, { transaction: t });
      await CommissionLedger.destroy({
        where: { subOrderId: subOrder.id, status: COMMISSION_STATUS.PENDING },
        transaction: t,
      });
      await TcsLedger.destroy({ where: { subOrderId: subOrder.id }, transaction: t });
    }

    await destroyCouponUsageForOrder(order.id, t);
    await cartService.restoreItemsToUserCart(order.userId, restoreLines, t);
    await rollbackOrderWalletIfNeeded(order, order.userId, t);

    await order.update(
      {
        status: ORDER_STATUS.CANCELLED,
        walletAmountUsed: 0,
        // Every suborder is cancelled here too — nothing will ever deliver, so no cashback is due.
        pendingCashbackAmount: 0,
        // Nothing was charged on an unpaid (COD) order — its wallet spend went back above —
        // so no refund is pending; "Refund processing" would never clear.
        cancelRefundStatus:
          order.paymentStatus === PAYMENT_STATUS.PAID ? REFUND_STATUS.PENDING : REFUND_STATUS.NONE,
        // Recorded with the cancel, so a refund cut off before it reached Razorpay is
        // found and retried (failStalledRefunds).
        cancelRefundAmountPaise: razorpayPaymentId && razorpayDue > 0 ? toPaise(razorpayDue) : null,
        updatedBy: userId,
      },
      { transaction: t },
    );
    cancelledOrderId = order.id;
  });

  for (const partId of remainingPartIds) {
    await subordersService.updateStatus(partId, ORDER_STATUS.CANCELLED, undefined, userId);
  }
  if (remainingPartIds.length > 0) return { orderId, cancelled: true };

  const order = await Order.findByPk(orderId);
  if (!order) throw new NotFoundError('Order');

  if (!alreadyCancelled) {
    if (order.paymentStatus === PAYMENT_STATUS.PAID) {
      if (razorpayPaymentId && razorpayDue > 0) {
        try {
          const refundId = await paymentsService.createRazorpayRefund(
            razorpayPaymentId,
            toPaise(razorpayDue),
            { orderId: order.id, reason: 'ORDER_CANCEL' },
          );
          await order.update({
            cancelRefundStatus: REFUND_STATUS.INITIATED,
            cancelRazorpayRefundId: refundId,
            cancelRefundAmountPaise: toPaise(razorpayDue),
          });
        } catch {
          await order.update({
            ...failedOrderRefundAttempt(),
            cancelRefundAmountPaise: toPaise(razorpayDue),
          });
        }
      } else {
        await order.update({
          paymentStatus: PAYMENT_STATUS.REFUNDED,
          cancelRefundStatus: REFUND_STATUS.COMPLETED,
        });
      }
    }

    void notificationsService.sendOrderCancelled(order.userId, order.id, {
      orderId: order.id,
      orderNumber: order.id.slice(0, 8).toUpperCase(),
    });

    await logAudit({
      actorId: userId,
      action: 'ORDER_CANCELLED',
      entityType: 'Order',
      entityId: order.id,
      metadata: { isAdmin, paymentStatus: order.paymentStatus, cancelRefundStatus: order.cancelRefundStatus },
    });
  }

  return { orderId: cancelledOrderId!, cancelled: true };
}
