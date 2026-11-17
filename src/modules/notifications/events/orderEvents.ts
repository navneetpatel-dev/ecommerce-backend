import { Op } from 'sequelize';
import { env } from '@config/env';
import { logger } from '@core/logger';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { ORDER_STATUS, PAYMENT_METHOD, PAYMENT_STATUS } from '@core/constants/statuses';
import { orderReference } from '@modules/orders/orderReference';
import { notificationsService } from '../notifications.service';
import { buildOrderEmailData } from '../orderEmailData';

const warn = (what: string, id: string, error: unknown) =>
  logger.warn(`${what} email failed`, { id, error: error instanceof Error ? error.message : error });

/** One part of an order was delivered. Sent by whichever path records the delivery first. */
export async function notifySubOrderDelivered(orderId: string, subOrderId: string): Promise<void> {
  try {
    const order = await Order.findByPk(orderId, { attributes: ['id', 'userId'] });
    if (!order) return;
    await notificationsService.sendSubOrderDelivered(order.userId, subOrderId, {
      orderId,
      orderNumber: orderReference(orderId),
      ...(await buildOrderEmailData(orderId, { subOrderId })),
    });
  } catch (error) {
    warn('Delivered', subOrderId, error);
  }
}

/** The carrier has the parcel out for delivery today. */
export async function notifyOutForDelivery(subOrderId: string, trackingNumber?: string | null): Promise<void> {
  try {
    const sub = await SubOrder.findByPk(subOrderId, { attributes: ['id', 'orderId'] });
    const order = sub ? await Order.findByPk(sub.orderId, { attributes: ['id', 'userId'] }) : null;
    if (!sub || !order) return;
    const rich = await buildOrderEmailData(order.id, { subOrderId, withAddress: true });
    await notificationsService.enqueue({
      userId: order.userId,
      type: 'ORDER_OUT_FOR_DELIVERY',
      referenceType: 'SubOrder',
      referenceId: subOrderId,
      templateData: {
        orderId: order.id,
        orderNumber: orderReference(order.id),
        ...rich,
        details: [...((rich.details as unknown[]) ?? []), ...(trackingNumber ? [{ label: 'Tracking number', value: trackingNumber }] : [])],
      },
    });
  } catch (error) {
    warn('Out for delivery', subOrderId, error);
  }
}

/** An unpaid online checkout was released: say so plainly (it is not a cancellation the shopper chose). */
export async function notifyCheckoutExpired(orderId: string): Promise<void> {
  try {
    const order = await Order.findByPk(orderId, { attributes: ['id', 'userId'] });
    if (!order) return;
    await notificationsService.enqueue({
      userId: order.userId,
      type: 'CHECKOUT_EXPIRED',
      referenceType: 'Order',
      referenceId: order.id,
      templateData: { orderId: order.id, orderNumber: orderReference(order.id), ...(await buildOrderEmailData(order.id)) },
    });
  } catch (error) {
    warn('Checkout expired', orderId, error);
  }
}

/**
 * A nudge for online checkouts still unpaid halfway through their payment window, so the
 * shopper can finish before it is released. One reminder per order.
 */
export async function processPaymentPendingReminders(now: Date = new Date()): Promise<number> {
  const ttlMs = env.CHECKOUT_PENDING_PAYMENT_TTL_MINUTES * 60 * 1000;
  const orders = await Order.findAll({
    where: {
      paymentMethod: PAYMENT_METHOD.RAZORPAY,
      paymentStatus: PAYMENT_STATUS.PENDING,
      status: { [Op.ne]: ORDER_STATUS.CANCELLED },
      createdAt: { [Op.lt]: new Date(now.getTime() - ttlMs / 2), [Op.gt]: new Date(now.getTime() - ttlMs) },
    },
    attributes: ['id', 'userId', 'createdAt'],
    limit: 200,
  });
  let queued = 0;
  for (const order of orders) {
    try {
      const expires = new Date(order.createdAt.getTime() + ttlMs);
      const log = await notificationsService.enqueue({
        userId: order.userId,
        type: 'CHECKOUT_PAYMENT_PENDING',
        referenceType: 'Order',
        referenceId: order.id,
        templateData: {
          orderId: order.id,
          orderNumber: orderReference(order.id),
          expiresAt: expires.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }),
          ...(await buildOrderEmailData(order.id, { withTotals: true })),
        },
      });
      if (log) queued += 1;
    } catch (error) {
      warn('Payment pending', order.id, error);
    }
  }
  return queued;
}
