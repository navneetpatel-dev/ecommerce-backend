import { ProductVariant } from '@database/models/productVariant.model';
import { Product } from '@database/models/product.model';
import { sequelize } from '@config/db';
import type { OrderItem as SortItem } from 'sequelize';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { lowStockQuery } from './lowStockWhere';
import type { LowStockQuery } from './inventory.dto';
import { NotFoundError } from '@core/errors/NotFoundError';
import { lockedStockEdit } from './applyStockEdit';
import { notifyBackInStock } from './backInStock';
import { createStockAlert, deleteStockAlert } from './stockAlerts.service';

export class InventoryService {
  /** One page of low-stock variants (see `lowStockQuery`), emptiest first unless asked otherwise. */
  async getLowStock(query: LowStockQuery & { vendorId?: string }) {
    const sortBy: SortItem =
      query.sort === 'name_asc'
        ? [{ model: Product, as: 'product' }, 'name', 'ASC']
        : ['stock', query.sort === 'stock_desc' ? 'DESC' : 'ASC'];
    const { rows, count } = await ProductVariant.findAndCountAll({
      ...lowStockQuery(query),
      order: [sortBy, ['id', 'ASC']],
      limit: query.limit,
      offset: paginationOffset(query.page, query.limit),
      distinct: true,
      col: 'id',
      subQuery: false,
    });
    return { rows, pagination: buildPaginationMeta(count, query.page, query.limit) };
  }

  async updateStock(variantId: string, requestedStock: number, updatedBy: string, expectedStock?: number) {
    // Back-in-stock notifications run after commit so the lock is not held during fan-out.
    const { updated, previousStock, stock } = await sequelize.transaction(async (t) => {
      const edit = await lockedStockEdit(variantId, requestedStock, expectedStock, t);
      const variant = await ProductVariant.findByPk(variantId, {
        include: [{ model: Product, as: 'product' }],
        transaction: t,
      });
      if (!variant) throw new NotFoundError('ProductVariant');
      const row = await variant.update({ stock: edit.next, updatedBy }, { transaction: t });
      return { updated: row, previousStock: edit.previous, stock: edit.next };
    });

    if (previousStock <= 0 && stock > 0) {
      const product = (updated as ProductVariant & { product?: Product }).product;
      if (product) {
        void this.notifyBackInStock(product.id, variantId);
      }
    }

    return updated;
  }

  // Back-in-stock alerts (see `backInStock.ts` and `stockAlerts.service.ts`).
  notifyBackInStock = notifyBackInStock;
  createStockAlert = createStockAlert;
  deleteStockAlert = deleteStockAlert;
}

export const inventoryService = new InventoryService();
