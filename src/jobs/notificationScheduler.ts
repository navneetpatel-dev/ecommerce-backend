import { Op, Sequelize } from 'sequelize';
import { env } from '@config/env';
import { logger } from '@core/logger';
import { Cart } from '@database/models/cart.model';
import { CartItem } from '@database/models/cartItem.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { Product } from '@database/models/product.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Order } from '@database/models/order.model';
import { User } from '@database/models/user.model';
import { Wishlist } from '@database/models/wishlist.model';
import { WishlistItem } from '@database/models/wishlistItem.model';
import { ORDER_STATUS } from '@core/constants/statuses';
import { notificationsService } from '@modules/notifications/notifications.service';

const SCHEDULER_INTERVAL_MS = 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

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
    const log = await notificationsService.sendAbandonedCart(cart.userId, cart.id, {
      cartId: cart.id,
    });
    if (log) sent += 1;
  }
  return sent;
}

async function processLowStock(): Promise<number> {
  const variants = await ProductVariant.findAll({
    where: Sequelize.where(
      Sequelize.col('stock'),
      Op.lte,
      Sequelize.col('lowStockAt'),
    ),
    include: [{ model: Product, as: 'product', required: true }],
    limit: 100,
  });

  let sent = 0;
  for (const variant of variants) {
    const product = (variant as ProductVariant & { product?: Product }).product;
    if (!product?.vendorId) continue;
    const owner = await User.findOne({
      where: { vendorId: product.vendorId },
      attributes: ['id'],
    });
    if (!owner) continue;
    const log = await notificationsService.sendLowStockAlert(owner.id, variant.id, {
      productName: product.name,
      sku: variant.sku,
      stock: Number(variant.stock ?? 0),
    });
    if (log) sent += 1;
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

  let sent = 0;
  for (const sub of suborders) {
    const order = (sub as SubOrder & { order?: Order }).order;
    if (!order?.userId) continue;
    const log = await notificationsService.sendReviewRequest(order.userId, sub.id, {
      orderId: order.id,
      orderNumber: order.id.slice(0, 8).toUpperCase(),
    });
    if (log) sent += 1;
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
      price: currentPrice,
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
    const [abandoned, lowStock, reviews, priceDrops, cashbacks, ticketsClosed, bugsVerified] =
      await Promise.all([
        processAbandonedCarts(),
        processLowStock(),
        processReviewRequests(),
        processWishlistPriceDrops(),
        processPendingCashbackCredits(),
        supportTicketsService.closeExpiredResolved(),
        bugReportsService.markVerifiedIfDue(),
      ]);
    const total =
      abandoned + lowStock + reviews + priceDrops + cashbacks + ticketsClosed + bugsVerified;
    if (total > 0) {
      logger.info('Notification scheduler tick', {
        abandoned,
        lowStock,
        reviews,
        priceDrops,
        cashbacks,
        ticketsClosed,
        bugsVerified,
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
  timer = setInterval(() => {
    void runNotificationSchedulerTick();
  }, SCHEDULER_INTERVAL_MS);
  logger.info('Notification scheduler started', { intervalMs: SCHEDULER_INTERVAL_MS });
}

export function stopNotificationScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
