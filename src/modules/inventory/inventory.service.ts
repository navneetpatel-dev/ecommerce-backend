import { ProductVariant } from '@database/models/productVariant.model';
import { Product } from '@database/models/product.model';
import { WishlistItem } from '@database/models/wishlistItem.model';
import { Wishlist } from '@database/models/wishlist.model';
import { StockAlert } from '@database/models/stockAlert.model';
import { Op, Sequelize } from 'sequelize';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ValidationError } from '@core/errors/ValidationError';
import { notificationsService } from '@modules/notifications/notifications.service';

export class InventoryService {
  async getLowStock(threshold?: number, vendorId?: string) {
    const productInclude = {
      model: Product,
      as: 'product' as const,
      ...(vendorId ? { where: { vendorId }, required: true as const } : {}),
    };

    if (threshold != null) {
      return ProductVariant.findAll({
        where: { stock: { [Op.lte]: threshold } },
        include: [productInclude],
        order: [['stock', 'ASC']],
      });
    }
    return ProductVariant.findAll({
      where: Sequelize.where(Sequelize.col('stock'), Op.lte, Sequelize.col('lowStockAt')),
      include: [productInclude],
      order: [['stock', 'ASC']],
    });
  }

  async updateStock(variantId: string, stock: number, updatedBy: string) {
    const variant = await ProductVariant.findByPk(variantId, {
      include: [{ model: Product, as: 'product' }],
    });
    if (!variant) throw new NotFoundError('ProductVariant');

    const previousStock = Number(variant.stock ?? 0);
    const updated = await variant.update({ stock, updatedBy } as any);

    if (previousStock <= 0 && stock > 0) {
      const product = (variant as ProductVariant & { product?: Product }).product;
      if (product) {
        const wishlistItems = await WishlistItem.findAll({
          where: { productId: product.id },
          include: [{ model: Wishlist, required: true }],
          limit: 200,
        });
        for (const item of wishlistItems) {
          const wishlist = (item as WishlistItem & { Wishlist?: Wishlist }).Wishlist;
          if (!wishlist?.userId) continue;
          void notificationsService.sendBackInStock(wishlist.userId, product.id, {
            productName: product.name,
          });
        }

        // Explicit subscribe/unsubscribe stock alerts (variant-scoped), additive to the
        // wishlist-based notifications above.
        const stockAlerts = await StockAlert.findAll({
          where: { variantId, notifiedAt: null },
          limit: 500,
        });
        for (const alert of stockAlerts) {
          if (alert.userId) {
            void notificationsService.sendBackInStock(alert.userId, product.id, {
              productName: product.name,
            });
          }
          // Guest (email-only) alerts: notificationsService.sendBackInStock requires a
          // userId (it enqueues via NotificationLog, which is keyed to a User). There is
          // no generic raw-email send path today, so guest notifications are a documented
          // v1 gap — we still stamp notifiedAt below so the alert doesn't linger forever.
        }
        if (stockAlerts.length) {
          await StockAlert.update(
            { notifiedAt: new Date() },
            { where: { id: { [Op.in]: stockAlerts.map((a) => a.id) } } },
          );
        }
      }
    }

    return updated;
  }

  async createStockAlert(variantId: string, userId: string | null, guestEmail?: string) {
    if (!userId && !guestEmail) {
      throw new ValidationError('Either an authenticated user or a guestEmail is required.');
    }
    const variant = await ProductVariant.findByPk(variantId);
    if (!variant) throw new NotFoundError('ProductVariant');

    const where = userId ? { variantId, userId } : { variantId, guestEmail };
    const [alert] = await StockAlert.findOrCreate({
      where,
      defaults: { variantId, userId: userId ?? null, guestEmail: userId ? null : guestEmail ?? null },
    });
    return alert;
  }

  async deleteStockAlert(
    id: string,
    requester: { userId?: string; isAdmin?: boolean; guestEmail?: string },
  ) {
    const alert = await StockAlert.findByPk(id);
    if (!alert) throw new NotFoundError('StockAlert');

    const isOwner = requester.userId && alert.userId === requester.userId;
    const isMatchingGuest =
      !alert.userId && alert.guestEmail && requester.guestEmail === alert.guestEmail;

    if (!requester.isAdmin && !isOwner && !isMatchingGuest) {
      throw new ForbiddenError('You cannot remove this stock alert.');
    }

    await alert.destroy();
  }
}

export const inventoryService = new InventoryService();
