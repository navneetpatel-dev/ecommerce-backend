import { Op, Sequelize } from 'sequelize';
import { logger } from '@core/logger';
import { Vendor } from '@database/models/vendor.model';
import { Product } from '@database/models/product.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { SubOrder } from '@database/models/subOrder.model';
import { OrderItem } from '@database/models/orderItem.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { NotificationLog } from '@database/models/notificationLog.model';
import { Payout } from '@database/models/payout.model';
import { User } from '@database/models/user.model';
import { Wishlist } from '@database/models/wishlist.model';
import { WishlistItem } from '@database/models/wishlistItem.model';
import { env } from '@config/env';
import { NOTIFICATION_STATUS, ORDER_STATUS, PRODUCT_STATUS, RETURN_STATUS, VENDOR_STATUS } from '@core/constants/statuses';
import { notificationsService } from '../notifications.service';
import { findSuperAdminUserIds, findVendorOwnerUserId } from '../orderNotifications';
import { inr } from '../templates/blocks';

const DAY_MS = 24 * 60 * 60 * 1000;
const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const shortDate = (date: Date) => date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
const change = (now: number, before: number) =>
  before > 0 ? ` (${now >= before ? '+' : '−'}${Math.round((Math.abs(now - before) / before) * 100)}%)` : '';

type WeekFigures = { orders: number; revenue: number; units: number };

async function weekFigures(vendorId: string, from: Date, to: Date): Promise<WeekFigures> {
  const parts = await SubOrder.findAll({
    where: { vendorId, createdAt: { [Op.gte]: from, [Op.lt]: to }, status: { [Op.ne]: ORDER_STATUS.CANCELLED } },
    attributes: ['id', 'subtotal'],
  });
  const ids = parts.map((part) => part.id);
  const units = ids.length ? Number((await OrderItem.sum('quantity', { where: { subOrderId: { [Op.in]: ids } } })) ?? 0) : 0;
  return { orders: parts.length, revenue: parts.reduce((sum, part) => sum + Number(part.subtotal ?? 0), 0), units };
}

/**
 * Each approved seller's week in one email (orders, revenue, units, returns, what needs
 * attention). One per seller per week; sellers with no activity and nothing pending are skipped.
 */
export async function processVendorWeeklySummaries(now: Date = new Date()): Promise<number> {
  const to = new Date(now);
  const from = new Date(now.getTime() - 7 * DAY_MS);
  const before = new Date(now.getTime() - 14 * DAY_MS);
  const vendors = await Vendor.findAll({ where: { status: VENDOR_STATUS.APPROVED }, attributes: ['id', 'businessName'] });
  let queued = 0;
  for (const vendor of vendors) {
    try {
      const [ownerId, thisWeek, lastWeek] = await Promise.all([findVendorOwnerUserId(vendor.id), weekFigures(vendor.id, from, to), weekFigures(vendor.id, before, from)]);
      if (!ownerId) continue;
      const [returnsOpen, lowStock, topRow] = await Promise.all([
        ReturnRequest.count({ include: [{ model: SubOrder, as: 'subOrder', required: true, where: { vendorId: vendor.id }, attributes: [] }], where: { status: RETURN_STATUS.REQUESTED } }),
        ProductVariant.count({ include: [{ model: Product, as: 'product', required: true, where: { vendorId: vendor.id }, attributes: [] }], where: Sequelize.where(Sequelize.col('ProductVariant.stock'), Op.lte, Sequelize.col('ProductVariant.lowStockAt')) }),
        OrderItem.findOne({
          attributes: ['productName', [Sequelize.fn('SUM', Sequelize.col('quantity')), 'sold']],
          include: [{ model: SubOrder, as: 'subOrder', required: true, attributes: [], where: { vendorId: vendor.id, createdAt: { [Op.gte]: from }, status: { [Op.ne]: ORDER_STATUS.CANCELLED } } }],
          group: ['productName'],
          order: [[Sequelize.literal('"sold"'), 'DESC']],
          raw: true,
        }),
      ]);
      if (thisWeek.orders === 0 && returnsOpen === 0 && lowStock === 0) continue;
      const bullets = [
        ...(returnsOpen ? [`${returnsOpen} return${returnsOpen > 1 ? 's' : ''} waiting for your review`] : []),
        ...(lowStock ? [`${lowStock} product${lowStock > 1 ? 's are' : ' is'} low on stock`] : []),
      ];
      const log = await notificationsService.enqueue({
        userId: ownerId,
        type: 'VENDOR_WEEKLY_SUMMARY',
        referenceType: 'VendorWeek',
        referenceId: `${vendor.id}-${dayKey(from)}`,
        templateData: {
          businessName: vendor.businessName,
          period: `${shortDate(from)} – ${shortDate(to)}`,
          details: [
            { label: 'Orders', value: `${thisWeek.orders}${change(thisWeek.orders, lastWeek.orders)}` },
            { label: 'Sales', value: `${inr(thisWeek.revenue)}${change(thisWeek.revenue, lastWeek.revenue)}` },
            { label: 'Units sold', value: String(thisWeek.units) },
            ...(topRow ? [{ label: 'Top product', value: String((topRow as unknown as { productName: string }).productName) }] : []),
          ],
          ...(bullets.length ? { bullets } : {}),
        },
      });
      if (log) queued += 1;
    } catch (error) {
      logger.warn('Weekly seller summary failed', { vendorId: vendor.id, error: error instanceof Error ? error.message : error });
    }
  }
  return queued;
}

/** What needs an admin's attention today, in one email to every super admin. */
export async function processAdminDailyDigest(now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - DAY_MS);
  const [vendorsPending, productsPending, returnsOpen, disputes, payoutsFailed, emailsFailed, emailsStuck] = await Promise.all([
    Vendor.count({ where: { status: VENDOR_STATUS.PENDING } }),
    Product.count({ where: { status: PRODUCT_STATUS.PENDING_APPROVAL } }),
    ReturnRequest.count({ where: { status: RETURN_STATUS.REQUESTED } }),
    ReturnRequest.count({ where: { disputeStatus: 'PENDING' } }),
    Payout.count({ where: { status: 'FAILED', updatedAt: { [Op.gte]: since } } }),
    NotificationLog.count({ where: { status: NOTIFICATION_STATUS.FAILED, updatedAt: { [Op.gte]: since } } }),
    NotificationLog.count({ where: { status: NOTIFICATION_STATUS.PENDING, createdAt: { [Op.lt]: new Date(now.getTime() - 60 * 60 * 1000) } } }),
  ]);
  const details = [
    { label: 'Vendors awaiting approval', value: String(vendorsPending) },
    { label: 'Products awaiting approval', value: String(productsPending) },
    { label: 'Returns awaiting action', value: String(returnsOpen) },
    { label: 'Open return disputes', value: String(disputes) },
    { label: 'Failed payouts (24h)', value: String(payoutsFailed) },
    { label: 'Emails failed (24h)', value: String(emailsFailed) },
    { label: 'Emails stuck over an hour', value: String(emailsStuck) },
  ];
  const attention = vendorsPending + productsPending + returnsOpen + disputes + payoutsFailed + emailsFailed + emailsStuck;
  if (attention === 0) return 0;
  let queued = 0;
  for (const adminId of await findSuperAdminUserIds()) {
    const log = await notificationsService.enqueue({
      userId: adminId,
      type: 'ADMIN_DAILY_DIGEST',
      referenceType: 'AdminDigest',
      referenceId: `${adminId}-${dayKey(now)}`,
      templateData: { period: shortDate(now), details },
    });
    if (log) queued += 1;
  }
  return queued;
}

/**
 * Weekly, for shoppers who opted in to marketing mail: the saved items that now cost less
 * than when they were saved. Only worth a digest when there are at least two.
 */
export async function processWishlistDigests(now: Date = new Date()): Promise<number> {
  const rows = await WishlistItem.findAll({
    include: [
      { model: Wishlist, required: true, include: [{ model: User, as: 'user', required: true, attributes: ['id'], where: { emailMarketingConsent: true, emailSuppressed: false } }] },
      { model: Product, as: 'product', required: true, where: { status: PRODUCT_STATUS.LIVE } },
    ],
    limit: 2000,
  });
  const byUser = new Map<string, Array<{ name: string; slug: string; was: number; now: number }>>();
  for (const row of rows) {
    const wishlist = (row as WishlistItem & { Wishlist?: Wishlist }).Wishlist;
    const product = (row as WishlistItem & { product?: Product }).product;
    if (!wishlist?.userId || !product) continue;
    const current = Number(product.displayPrice ?? product.basePrice ?? 0);
    const was = Number(row.priceAtAdd ?? 0);
    if (!(was > 0 && current > 0 && current < was)) continue;
    byUser.set(wishlist.userId, [...(byUser.get(wishlist.userId) ?? []), { name: product.name, slug: product.slug, was, now: current }]);
  }
  const week = Math.floor(now.getTime() / (7 * DAY_MS));
  const base = env.CLIENT_URL.replace(/\/$/, '');
  let queued = 0;
  for (const [userId, drops] of byUser) {
    if (drops.length < 2) continue;
    const log = await notificationsService.enqueue({
      userId,
      type: 'WISHLIST_DIGEST',
      referenceType: 'WishlistWeek',
      referenceId: `${userId}-w${week}`,
      templateData: {
        itemsTitle: 'Price drops on your wishlist',
        items: drops.slice(0, 6).map((drop) => ({ name: drop.name, meta: `Was ${inr(drop.was)}, now ${inr(drop.now)}`, quantity: 1, price: inr(drop.now) })),
        productUrl: `${base}/wishlist`,
      },
    });
    if (log) queued += 1;
  }
  return queued;
}

