import { Op, Sequelize, type FindOptions, type WhereOptions } from 'sequelize';
import { PRODUCT_STATUS } from '@core/constants/statuses';
import { Product } from '@database/models/product.model';
import { escapeLikePattern } from '@modules/search/search.utils';

export type LowStockLevel = 'OUT_OF_STOCK' | 'CRITICAL';

/** "Critical" on the inventory screen: this many units or fewer. */
const CRITICAL_UNITS = 5;

/**
 * Which variants are low on stock, for the inventory list, the daily digest and the weekly
 * summary alike: at or under each variant's own alert level (or `threshold` when one is asked
 * for), on products that still exist and are not archived.
 */
export function lowStockQuery(
  options: { threshold?: number; vendorId?: string; search?: string; level?: LowStockLevel } = {},
): Pick<FindOptions, 'where' | 'include'> {
  const { threshold, vendorId, search, level } = options;
  const conditions: WhereOptions[] = [
    threshold === undefined
      ? (Sequelize.where(Sequelize.col('ProductVariant.stock'), Op.lte, Sequelize.col('ProductVariant.lowStockAt')) as never)
      : { stock: { [Op.lte]: threshold } },
  ];
  if (level) conditions.push({ stock: { [Op.lte]: level === 'OUT_OF_STOCK' ? 0 : CRITICAL_UNITS } });
  const term = search ? escapeLikePattern(search) : '';
  if (term) {
    conditions.push({ [Op.or]: [{ sku: { [Op.iLike]: `%${term}%` } }, { '$product.name$': { [Op.iLike]: `%${term}%` } }] });
  }
  return {
    where: { [Op.and]: conditions },
    include: [
      {
        model: Product,
        as: 'product' as const,
        required: true,
        attributes: ['id', 'name', 'slug', 'vendorId', 'status'],
        where: { status: { [Op.ne]: PRODUCT_STATUS.ARCHIVED }, ...(vendorId ? { vendorId } : {}) },
      },
    ],
  };
}
