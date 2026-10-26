import { sequelize } from '@database/models';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { OrderItem } from '@database/models/orderItem.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import {
  ORDER_STATUS,
  PAYMENT_STATUS,
  COMMISSION_STATUS,
  allSubOrdersCancellable,
} from '@core/constants/statuses';
import { cartService } from '@modules/cart/cart.service';
import { destroyCouponUsageForOrder } from '@modules/coupons/couponEngine';
import { rollbackOrderWalletIfNeeded } from '@modules/wallet/walletOrderRollback';

type OrderForRollback = Order & {
  subOrders?: (SubOrder & { items?: OrderItem[] })[];
};

export const unpaidOrders = {
  /**
   * Cancel an online order that was never paid: restock, void its ledgers and coupon
   * use, return the items to the cart and the wallet money applied at checkout.
   */
  async cancel(
    where: { razorpayOrderId: string } | { id: string },
  ): Promise<string | null> {
    let cancelledOrderId: string | null = null;
    await sequelize.transaction(async (t) => {
      const locked = await Order.findOne({
        where,
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!locked) return;
      if (locked.paymentStatus === PAYMENT_STATUS.PAID) return;

      if (locked.status === ORDER_STATUS.CANCELLED) {
        const walletRestored = await rollbackOrderWalletIfNeeded(locked, locked.userId, t);
        if (walletRestored) {
          await locked.update({ walletAmountUsed: 0 }, { transaction: t });
        }
        cancelledOrderId = locked.id;
        return;
      }

      const orderResult = await Order.findByPk(locked.id, {
        include: [
          {
            model: SubOrder,
            as: 'subOrders',
            include: [{ model: OrderItem, as: 'items' }],
          },
        ],
        transaction: t,
      });

      if (!orderResult) return;

      const order = orderResult as OrderForRollback;

      // Defense in depth, matching checkout.service.ts's cancelPendingCheckout and
      // ordersCancel.service.ts's cancelPaidOrder: never restock/un-order a suborder that has
      // already moved past pre-shipment, even though a `payment.failed` webhook for an order
      // still PENDING payment shouldn't normally reach a shipped suborder.
      if (!allSubOrdersCancellable(order.subOrders ?? [])) return;

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
      }

      await destroyCouponUsageForOrder(order.id, t);

      await cartService.restoreItemsToUserCart(order.userId, restoreLines, t);

      await rollbackOrderWalletIfNeeded(order, order.userId, t);

      await order.update(
        {
          status: ORDER_STATUS.CANCELLED,
          paymentStatus: PAYMENT_STATUS.FAILED,
          walletAmountUsed: 0,
        },
        { transaction: t },
      );
      cancelledOrderId = order.id;
    });
    return cancelledOrderId;
  },
};
