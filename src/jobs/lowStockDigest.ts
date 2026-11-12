import { Op, Sequelize } from 'sequelize';
import { redisClient, withRedis } from '@config/redis';
import { ProductVariant } from '@database/models/productVariant.model';
import { Product } from '@database/models/product.model';
import { User } from '@database/models/user.model';
import { notificationsService } from '@modules/notifications/notifications.service';

/** Variants a seller has already been told about; cleared once restocked above the threshold. */
const ALERTED_SET = 'low-stock:alerted';
const MAX_LINES = 10;

type LowVariant = ProductVariant & { product?: Product };

/** "Classic Tee (SKU-1): 2 left; Mug (SKU-9): 0 left" — what the digest lists. */
function stockList(variants: LowVariant[]): string {
  const lines = variants
    .slice(0, MAX_LINES)
    .map((v) => `${v.product?.name ?? 'Product'} (${v.sku}): ${Number(v.stock ?? 0)} left`);
  const more = variants.length - MAX_LINES;
  return more > 0 ? `${lines.join('; ')}; and ${more} more` : lines.join('; ');
}

/** Forget variants that were restocked, so a later drop alerts again. */
async function clearRestocked(): Promise<void> {
  const alerted = (await withRedis(() => redisClient.smembers(ALERTED_SET))) ?? [];
  if (!alerted.length) return;
  const restocked = await ProductVariant.findAll({
    where: { id: alerted, [Op.and]: [Sequelize.where(Sequelize.col('stock'), Op.gt, Sequelize.col('lowStockAt'))] },
    attributes: ['id'],
  });
  if (restocked.length) await withRedis(() => redisClient.srem(ALERTED_SET, ...restocked.map((v) => v.id)));
}

/**
 * One low-stock email per seller per day, listing every variant that newly went
 * low. Before, each low variant sent its own email (15 identical ones in three
 * seconds for one seller), and the same variants were mailed again every day.
 */
export async function processLowStock(): Promise<number> {
  await clearRestocked();
  const low = (await ProductVariant.findAll({
    where: Sequelize.where(Sequelize.col('stock'), Op.lte, Sequelize.col('lowStockAt')),
    include: [{ model: Product, as: 'product', required: true, attributes: ['id', 'name', 'vendorId'] }],
    limit: 500,
  })) as LowVariant[];
  const alerted = new Set((await withRedis(() => redisClient.smembers(ALERTED_SET))) ?? []);

  const byVendor = new Map<string, LowVariant[]>();
  for (const variant of low) {
    const vendorId = variant.product?.vendorId;
    if (!vendorId || alerted.has(variant.id)) continue;
    byVendor.set(vendorId, [...(byVendor.get(vendorId) ?? []), variant]);
  }

  let sent = 0;
  for (const [vendorId, variants] of byVendor) {
    const owner = await User.findOne({ where: { vendorId }, attributes: ['id'] });
    if (!owner) continue;
    const first = variants[0]!.product?.name ?? 'your products';
    const log = await notificationsService.sendLowStockAlert(owner.id, vendorId, {
      productName: variants.length > 1 ? `${first} and ${variants.length - 1} more` : first,
      sku: variants[0]!.sku,
      stock: Number(variants[0]!.stock ?? 0),
      stockList: stockList(variants),
    });
    if (log) {
      sent += 1;
      await withRedis(() => redisClient.sadd(ALERTED_SET, ...variants.map((v) => v.id)));
    }
  }
  return sent;
}
