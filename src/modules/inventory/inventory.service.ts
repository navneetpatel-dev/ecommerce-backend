import { ProductVariant } from '@database/models/productVariant.model';
import { Product } from '@database/models/product.model';
import { Op } from 'sequelize';
import { NotFoundError } from '@core/errors/NotFoundError';

export class InventoryService {
  async getLowStock(threshold: number) {
    return ProductVariant.findAll({
      where: { stock: { [Op.lte]: threshold } },
      include: [{ model: Product, as: 'product' }],
      order: [['stock', 'ASC']],
    });
  }

  async updateStock(variantId: string, stock: number, updatedBy: string) {
    const variant = await ProductVariant.findByPk(variantId);
    if (!variant) throw new NotFoundError('ProductVariant');
    return variant.update({ stock, updatedBy } as any);
  }
}

export const inventoryService = new InventoryService();
