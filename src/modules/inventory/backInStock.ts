import { Op } from 'sequelize';
import { logger } from '@core/logger';
import { resolveItemAvailability } from '@core/catalog/customerVisibility';
import { PURCHASABLE_PRODUCT_INCLUDE } from '@core/catalog/purchasableInclude';
import { Product } from '@database/models/product.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { StockAlert } from '@database/models/stockAlert.model';
import { User } from '@database/models/user.model';
import { Wishlist } from '@database/models/wishlist.model';
import { WishlistItem } from '@database/models/wishlistItem.model';
import { notificationsService } from '@modules/notifications/notifications.service';
import { markAboveMrp } from '@modules/tax/markAboveMrp';
import { productPageUrl, stockAlertCancelUrl } from './stockAlertLinks';

const BATCH = 500;
const WISHLIST_LIMIT = 200;

/** The email an alert asked for. False when nothing was queued, so the alert stays waiting. */
async function sendRequestedAlert(alert: StockAlert, product: Product): Promise<boolean> {
  if (alert.userId) {
    const user = await User.findByPk(alert.userId, { attributes: ['id', 'emailSuppressed'] });
    if (!user || user.emailSuppressed) return false;
  }
  const log = await notificationsService.enqueue({
    ...(alert.userId ? { userId: alert.userId } : { to: { email: alert.guestEmail! } }),
    type: 'STOCK_ALERT_REQUESTED',
    referenceType: 'StockAlert',
    // One email per time the shopper asked: asking again moves `updatedAt`.
    referenceId: `${alert.id}:${new Date(alert.updatedAt).getTime()}`,
    templateData: {
      productName: product.name,
      productUrl: productPageUrl(product.slug),
      cancelAlertUrl: stockAlertCancelUrl(alert.id),
    },
  });
  return log != null;
}

/** Everyone who asked about this variant, a batch at a time; returns the accounts that were told. */
async function tellSubscribers(variantId: string, product: Product): Promise<Set<string>> {
  const told = new Set<string>();
  let after = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const alerts = await StockAlert.findAll({
      where: { variantId, notifiedAt: null, id: { [Op.gt]: after } },
      order: [['id', 'ASC']],
      limit: BATCH,
    });
    const sent: string[] = [];
    for (const alert of alerts) {
      if (!(await sendRequestedAlert(alert, product))) continue;
      sent.push(alert.id);
      if (alert.userId) told.add(alert.userId);
    }
    // `silent`: marking an alert sent must not look like the shopper asking again.
    if (sent.length) await StockAlert.update({ notifiedAt: new Date() }, { where: { id: { [Op.in]: sent } }, silent: true });
    if (alerts.length < BATCH) return told;
    after = alerts[alerts.length - 1]!.id;
  }
}

/**
 * A variant came back: email those who asked about it, and those who saved the product (marketing
 * mail, so only with consent). Nothing is sent unless the variant can actually be bought. Never throws.
 */
export async function notifyBackInStock(productId: string, variantId: string): Promise<void> {
  try {
    const product = await Product.findByPk(productId, { include: PURCHASABLE_PRODUCT_INCLUDE });
    const variant = await ProductVariant.findByPk(variantId);
    if (!product || !variant) return;
    await markAboveMrp([variant], () => product);
    const { isAvailable } = resolveItemAvailability({
      product,
      vendor: (product as Product & { vendor?: { status?: string; kycVerified?: boolean } }).vendor,
      stock: Number(variant.stock),
      quantity: 1,
      aboveMrp: variant.aboveMrp,
    });
    if (!isAvailable) return;

    const told = await tellSubscribers(variantId, product);
    const saved = await WishlistItem.findAll({
      where: { productId: product.id },
      include: [{ model: Wishlist, required: true }],
      limit: WISHLIST_LIMIT,
    });
    for (const item of saved) {
      const userId = (item as WishlistItem & { Wishlist?: Wishlist }).Wishlist?.userId;
      if (!userId || told.has(userId)) continue;
      void notificationsService.sendBackInStock(userId, product.id, {
        productName: product.name,
        productUrl: productPageUrl(product.slug),
      });
    }
  } catch (error) {
    logger.error('Back-in-stock notices failed', {
      variantId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
