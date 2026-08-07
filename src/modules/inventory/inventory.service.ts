import { ProductVariant } from '@database/models/productVariant.model';
import { Product } from '@database/models/product.model';
import { WishlistItem } from '@database/models/wishlistItem.model';
import { Wishlist } from '@database/models/wishlist.model';
import { Op, Sequelize } from 'sequelize';
import { NotFoundError } from '@core/errors/NotFoundError';
import { notificationsService } from '@modules/notifications/notifications.service';

export class InventoryService {
  async getLowStock(threshold?: number) {
    if (threshold != null) {
      return ProductVariant.findAll({
        where: { stock: { [Op.lte]: threshold } },
        include: [{ model: Product, as: 'product' }],
        order: [['stock', 'ASC']],
      });
    }
    return ProductVariant.findAll({
      where: Sequelize.where(Sequelize.col('stock'), Op.lte, Sequelize.col('lowStockAt')),
      include: [{ model: Product, as: 'product' }],
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
      }
    }

    return updated;
  }
}

export const inventoryService = new InventoryService();
