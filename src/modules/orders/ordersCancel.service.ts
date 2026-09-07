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
  PAYMENT_STATUS,
  COMMISSION_STATUS,
  REFUND_STATUS,
} from '@core/constants/statuses';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { cartService } from '@modules/cart/cart.service';
import { destroyCouponUsageForOrder } from '@modules/coupons/couponEngine';
import { paymentsService } from '@modules/payments/payments.service';
import { checkoutAmountDue } from '@modules/pricing/displayMoney';
import { roundMoney } from '@modules/pricing/money';
import { rollbackOrderWalletIfNeeded } from '@modules/wallet/walletOrderRollback';
import { notificationsService } from '@modules/notifications/notifications.service';
import { logAudit } from '@modules/audit/audit.service';

const CANCELLABLE_SUB_STATUSES = new Set<string>([
  ORDER_STATUS.PENDING,
  ORDER_STATUS.CONFIRMED,
]);

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

  await sequelize.transaction(async (t) => {
    const locked = await Order.findByPk(orderId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!locked) throw new NotFoundError('Order');
    if (!isAdmin && locked.userId !== userId) {
      throw new ForbiddenError(ERROR_MESSAGES.NO_ACCESS_TO_ORDER);
    }
    if (locked.paymentStatus !== PAYMENT_STATUS.PAID && !isAdmin) {
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

    razorpayDue = roundMoney(
      Number(order.razorpayAmountPaid) ||
        checkoutAmountDue(Number(order.totalAmount), Number(order.walletAmountUsed ?? 0)),
    );
    razorpayPaymentId = order.razorpayPaymentId;

    for (const subOrder of order.subOrders ?? []) {
      if (!CANCELLABLE_SUB_STATUSES.has(subOrder.status)) {
        throw new ValidationError(ERROR_MESSAGES.ORDER_CANCEL_ITEMS_SHIPPED);
      }
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
        cancelRefundStatus: REFUND_STATUS.PENDING,
        updatedBy: userId,
      },
      { transaction: t },
    );
    cancelledOrderId = order.id;
  });

  const order = await Order.findByPk(orderId);
  if (!order) throw new NotFoundError('Order');

  if (!alreadyCancelled) {
    if (order.paymentStatus === PAYMENT_STATUS.PAID) {
      if (razorpayPaymentId && razorpayDue > 0) {
        try {
          const refundId = await paymentsService.createRazorpayRefund(
            razorpayPaymentId,
            Math.round(razorpayDue * 100),
            { orderId: order.id, reason: 'ORDER_CANCEL' },
          );
          await order.update({
            cancelRefundStatus: REFUND_STATUS.INITIATED,
            cancelRazorpayRefundId: refundId,
          });
        } catch {
          await order.update({ cancelRefundStatus: REFUND_STATUS.FAILED });
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
