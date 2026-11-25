import { Op } from 'sequelize';
import { env } from '@config/env';
import { logger } from '@core/logger';
import { Cart } from '@database/models/cart.model';
import { CartItem } from '@database/models/cartItem.model';
import { Product } from '@database/models/product.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Order } from '@database/models/order.model';
import { Wishlist } from '@database/models/wishlist.model';
import { WishlistItem } from '@database/models/wishlistItem.model';
import { ORDER_STATUS } from '@core/constants/statuses';
import { notificationsService } from '@modules/notifications/notifications.service';
import { broadcastService } from '@modules/notifications/broadcast.service';
import { processLowStock } from './lowStockDigest';
import { runPeriodicEmails } from './periodicEmails';
import { orderReference } from '@modules/orders/orderReference';
import { buildCartEmailData, buildOrderEmailData } from '@modules/notifications/orderEmailData';
import { inr } from '@modules/notifications/templates/blocks';

const SCHEDULER_INTERVAL_MS = 60 * 60 * 1000;
const BROADCAST_POLL_MS = 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let broadcastTimer: NodeJS.Timeout | null = null;

async function processAbandonedCarts(): Promise<number> {
  const cutoff = new Date(Date.now() - env.ABANDONED_CART_HOURS * 60 * 60 * 1000);
  const carts = await Cart.findAll({
    where: {
      userId: { [Op.ne]: null },
      updatedAt: { [Op.lte]: cutoff },
    },
    include: [{ model: CartItem, as: 'items', required: true }],
    limit: 100,
  });

  let sent = 0;
  for (const cart of carts) {
    if (!cart.userId) continue;
    try {
      const log = await notificationsService.sendAbandonedCart(cart.userId, cart.id, {
        cartId: cart.id,
        ...(await buildCartEmailData(cart.id)),
      });
      if (log) sent += 1;
    } catch (error) {
      // One shopper's email must not stop the rest of the batch.
      logger.warn('Abandoned cart email failed', { cartId: cart.id, error: error instanceof Error ? error.message : error });
    }
  }
  return sent;
}

async function processReviewRequests(): Promise<number> {
  const delayMs = env.REVIEW_REQUEST_DELAY_DAYS * 24 * 60 * 60 * 1000;
  const windowEnd = new Date(Date.now() - delayMs);
  const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000);

  const suborders = await SubOrder.findAll({
    where: {
      status: ORDER_STATUS.DELIVERED,
      updatedAt: { [Op.between]: [windowStart, windowEnd] },
    },
    include: [{ model: Order, as: 'order', required: true }],
    limit: 100,
  });

  // One email per order, not one per seller part (one shopper got four in nine
  // seconds); the sender also caps it at one per shopper per day.
  const orders = new Map<string, Order>();
  for (const sub of suborders) {
    const order = (sub as SubOrder & { order?: Order }).order;
    if (order?.userId) orders.set(order.id, order);
  }
  let sent = 0;
  for (const order of orders.values()) {
    try {
      const log = await notificationsService.sendReviewRequest(order.userId, order.id, {
        orderId: order.id,
        orderNumber: orderReference(order.id),
        ...(await buildOrderEmailData(order.id)),
      });
      if (log) sent += 1;
    } catch (error) {
      logger.warn('Review request email failed', { orderId: order.id, error: error instanceof Error ? error.message : error });
    }
  }
  return sent;
}

/** Wishlist marketing: price drops vs priceAtAdd snapshot. */
async function processWishlistPriceDrops(): Promise<number> {
  const items = await WishlistItem.findAll({
    include: [
      { model: Wishlist, required: true },
      { model: Product, as: 'product', required: true },
    ],
    limit: 200,
  });

  let sent = 0;
  for (const item of items) {
    const wishlist = (item as WishlistItem & { Wishlist?: Wishlist }).Wishlist;
    const product = (item as WishlistItem & { product?: Product }).product;
    if (!wishlist?.userId || !product) continue;

    const currentPrice = Number(product.basePrice ?? 0);
    const priceAtAdd = Number(item.priceAtAdd ?? 0);
    if (!(priceAtAdd > 0 && currentPrice > 0 && currentPrice < priceAtAdd)) continue;

    const log = await notificationsService.sendPriceDropAlert(wishlist.userId, product.id, {
      productName: product.name,
      // The GST-inclusive price the product page shows.
      price: Number(product.displayPrice ?? currentPrice),
      productUrl: `${env.CLIENT_URL.replace(/\/$/, '')}/products/${product.slug}`,
      details: [{ label: 'You saved it at', value: inr(priceAtAdd) }, { label: 'Now', value: inr(Number(product.displayPrice ?? currentPrice)), strong: true }],
    });
    if (log) sent += 1;
  }
  return sent;
}

export async function runNotificationSchedulerTick(): Promise<void> {
  try {
    const { processPendingCashbackCredits } = await import('@modules/wallet/cashback.service');
    const { supportTicketsService } = await import('@modules/supportTickets/supportTickets.service');
    const { bugReportsService } = await import('@modules/bugReports/bugReports.service');
    const [
      abandoned,
      lowStock,
      reviews,
      priceDrops,
      cashbacks,
      ticketsClosed,
      ticketsEscalated,
      bugsVerified,
      bugsClosed,
    ] = await Promise.all([
      processAbandonedCarts(),
      processLowStock(),
      processReviewRequests(),
      processWishlistPriceDrops(),
      processPendingCashbackCredits(),
      supportTicketsService.closeExpiredResolved(),
      supportTicketsService.escalateOverdueTickets(),
      bugReportsService.markVerifiedIfDue(),
      bugReportsService.markClosedIfDue(),
    ]);
    const total =
      abandoned +
      lowStock +
      reviews +
      priceDrops +
      cashbacks +
      ticketsClosed +
      ticketsEscalated +
      bugsVerified +
      bugsClosed;
    const periodic = await runPeriodicEmails();
    if (total > 0 || Object.values(periodic).some((count) => count > 0)) {
      logger.info('Notification scheduler tick', {
        periodic,
        abandoned,
        lowStock,
        reviews,
        priceDrops,
        cashbacks,
        ticketsClosed,
        ticketsEscalated,
        bugsVerified,
        bugsClosed,
      });
    }
  } catch (error) {
    logger.warn('Notification scheduler tick failed', {
      error: error instanceof Error ? error.message : error,
    });
  }
}

export function startNotificationScheduler(): void {
  if (timer) return;
  void runNotificationSchedulerTick();
  void broadcastService.processDueScheduledBroadcasts();
  timer = setInterval(() => {
    void runNotificationSchedulerTick();
  }, SCHEDULER_INTERVAL_MS);
  broadcastTimer = setInterval(() => {
    void broadcastService.processDueScheduledBroadcasts();
  }, BROADCAST_POLL_MS);
  logger.info('Notification scheduler started', { intervalMs: SCHEDULER_INTERVAL_MS });
}

export function stopNotificationScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (broadcastTimer) {
    clearInterval(broadcastTimer);
    broadcastTimer = null;
  }
}
