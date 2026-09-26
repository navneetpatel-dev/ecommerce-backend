import { Op } from 'sequelize';
import { OrderItem } from '@database/models/orderItem.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { Product } from '@database/models/product.model';
import { resolveReturnWindowForCategory } from '@modules/products/pdpPolicy';

const DAY_MS = 24 * 60 * 60 * 1000;

export type DeliveredSubOrder = { id: string; deliveredAt: Date };

/**
 * Sub-orders whose items can still be returned: delivered less than the longest return
 * window of their items' categories ago. The payout run's candidate scan only holds a
 * sale for the platform default window, but a category can allow longer; paying out
 * inside that window let a later return refund the customer out of money the vendor
 * had already been paid.
 */
export async function subOrdersInReturnWindow(
  subOrders: DeliveredSubOrder[],
  now: Date = new Date(),
): Promise<Set<string>> {
  const held = new Set<string>();
  if (subOrders.length === 0) return held;

  const items = await OrderItem.findAll({
    where: { subOrderId: { [Op.in]: subOrders.map((sub) => sub.id) } },
    attributes: ['subOrderId'],
    include: [
      {
        model: ProductVariant,
        as: 'variant',
        attributes: ['id'],
        include: [{ model: Product, as: 'product', attributes: ['categoryId'] }],
      },
    ],
  });

  const windowByCategory = new Map<string, number>();
  const longestBySubOrder = new Map<string, number>();
  for (const item of items) {
    const categoryId =
      (item as OrderItem & { variant?: { product?: { categoryId?: string | null } } }).variant
        ?.product?.categoryId ?? '';
    if (!windowByCategory.has(categoryId)) {
      const window = await resolveReturnWindowForCategory(categoryId || null);
      windowByCategory.set(categoryId, window.returnWindowDays ?? 0);
    }
    const days = windowByCategory.get(categoryId)!;
    longestBySubOrder.set(item.subOrderId, Math.max(longestBySubOrder.get(item.subOrderId) ?? 0, days));
  }

  for (const sub of subOrders) {
    const days = longestBySubOrder.get(sub.id) ?? 0;
    if (sub.deliveredAt.getTime() + days * DAY_MS > now.getTime()) held.add(sub.id);
  }
  return held;
}
