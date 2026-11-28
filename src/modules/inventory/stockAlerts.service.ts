import { NotFoundError } from '@core/errors/NotFoundError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ValidationError } from '@core/errors/ValidationError';
import { Product } from '@database/models/product.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { StockAlert } from '@database/models/stockAlert.model';
import { notificationsService } from '@modules/notifications/notifications.service';
import { alertIdFromToken, productPageUrl, stockAlertCancelUrl } from './stockAlertLinks';

/** A guest gets a short confirmation, with the way to cancel before anything else is sent. */
async function confirmToGuest(alert: StockAlert, productId: string): Promise<void> {
  const product = await Product.findByPk(productId, { attributes: ['name', 'slug'] });
  if (!product) return;
  await notificationsService.enqueue({
    to: { email: alert.guestEmail! },
    type: 'STOCK_ALERT_CONFIRMED',
    referenceType: 'StockAlert',
    referenceId: `${alert.id}:${new Date(alert.updatedAt).getTime()}`,
    templateData: {
      productName: product.name,
      productUrl: productPageUrl(product.slug),
      cancelAlertUrl: stockAlertCancelUrl(alert.id),
    },
  });
}

/** Asks to be told when a variant is back. Asking again after a notice was sent re-arms the alert. */
export async function createStockAlert(variantId: string, userId: string | null, guestEmail?: string) {
  const email = guestEmail?.trim().toLowerCase();
  if (!userId && !email) {
    throw new ValidationError('Either an authenticated user or a guestEmail is required.');
  }
  const variant = await ProductVariant.findByPk(variantId);
  if (!variant) throw new NotFoundError('ProductVariant');

  const where = userId ? { variantId, userId } : { variantId, guestEmail: email };
  const [alert, created] = await StockAlert.findOrCreate({
    where,
    defaults: { variantId, userId: userId ?? null, guestEmail: userId ? null : email ?? null },
  });
  const rearmed = !created && Boolean(alert.notifiedAt);
  if (rearmed) await alert.update({ notifiedAt: null });
  if (!userId && (created || rearmed)) await confirmToGuest(alert, variant.productId);
  return alert;
}

/** A signed-in shopper removes their own alert (or a catalog admin removes one). */
export async function deleteStockAlert(id: string, requester: { userId?: string; isAdmin?: boolean }) {
  const alert = await StockAlert.findByPk(id);
  if (!alert) throw new NotFoundError('StockAlert');
  const isOwner = Boolean(requester.userId) && alert.userId === requester.userId;
  if (!requester.isAdmin && !isOwner) throw new ForbiddenError('You cannot remove this stock alert.');
  await alert.destroy();
}

/** The cancel link in an alert email. Using it twice is not an error. */
export async function cancelStockAlertByToken(token: string): Promise<{ unsubscribed: true }> {
  await StockAlert.destroy({ where: { id: alertIdFromToken(token) } });
  return { unsubscribed: true };
}
