import { Op } from 'sequelize';
import { logger } from '@core/logger';
import { ORDER_STATUS } from '@core/constants/statuses';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { OrderItem } from '@database/models/orderItem.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { ProductAffinity } from '@database/models/productAffinity.model';

/** Nightly cadence — mirrors notificationScheduler.ts's setInterval scheduler rather than BullMQ. */
const SCHEDULER_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Bounds the aggregation to recent history so the nightly scan doesn't grow unbounded forever. */
const LOOKBACK_DAYS = 180;
/** Related products kept per product (matches the PDP rail's display count). */
const TOP_N_RELATED = 10;

let timer: NodeJS.Timeout | null = null;

type OrderItemWithJoins = OrderItem & {
  subOrder?: SubOrder & { order?: Order };
  variant?: ProductVariant;
};

/**
 * Co-occurrence is grouped by `Order` (the customer's single checkout), not `SubOrder`
 * (the per-vendor slice one Order splits into). "Frequently bought together" is meant to
 * answer "what else did shoppers add to this same cart" — that holds across vendors, since
 * a customer doesn't perceive the vendor split at checkout. Grouping by SubOrder instead
 * would silently drop every cross-vendor pairing, which is most of the interesting signal
 * in a multi-vendor marketplace.
 */
export async function runProductAffinityJob(): Promise<{
  productsUpdated: number;
  pairsUpserted: number;
}> {
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const items = (await OrderItem.findAll({
    attributes: ['id'],
    include: [
      {
        model: SubOrder,
        as: 'subOrder',
        attributes: ['id'],
        required: true,
        include: [
          {
            model: Order,
            as: 'order',
            attributes: ['id'],
            required: true,
            where: {
              status: { [Op.ne]: ORDER_STATUS.CANCELLED },
              createdAt: { [Op.gte]: cutoff },
            },
          },
        ],
      },
      { model: ProductVariant, as: 'variant', attributes: ['productId'], required: true },
    ],
  })) as OrderItemWithJoins[];

  // orderId -> distinct productIds bought together in that single checkout.
  const orderProducts = new Map<string, Set<string>>();
  for (const item of items) {
    const orderId = item.subOrder?.order?.id;
    const productId = item.variant?.productId;
    if (!orderId || !productId) continue;
    let set = orderProducts.get(orderId);
    if (!set) {
      set = new Set();
      orderProducts.set(orderId, set);
    }
    set.add(productId);
  }

  // Denominator for the normalized score: how many orders contained this product at all.
  const productOrderTotals = new Map<string, number>();
  for (const productSet of orderProducts.values()) {
    for (const productId of productSet) {
      productOrderTotals.set(productId, (productOrderTotals.get(productId) ?? 0) + 1);
    }
  }

  // productId -> relatedProductId -> co-occurrence count.
  const pairCounts = new Map<string, Map<string, number>>();
  for (const productSet of orderProducts.values()) {
    if (productSet.size < 2) continue;
    const products = Array.from(productSet);
    for (const productId of products) {
      let related = pairCounts.get(productId);
      if (!related) {
        related = new Map();
        pairCounts.set(productId, related);
      }
      for (const relatedProductId of products) {
        if (relatedProductId === productId) continue;
        related.set(relatedProductId, (related.get(relatedProductId) ?? 0) + 1);
      }
    }
  }

  const now = new Date();
  let pairsUpserted = 0;

  for (const [productId, related] of pairCounts) {
    const total = productOrderTotals.get(productId) ?? 0;
    const top = Array.from(related.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N_RELATED);

    for (const [relatedProductId, coOccurrenceCount] of top) {
      await ProductAffinity.upsert({
        productId,
        relatedProductId,
        coOccurrenceCount,
        score: total > 0 ? coOccurrenceCount / total : 0,
        computedAt: now,
      });
      pairsUpserted += 1;
    }

    // Drop anything that fell out of this product's top-N so stale pairs don't linger.
    // `top` is derived from `related`, which is only ever populated with at least one
    // entry (we only reach this branch for products with 2+ items in some order), so
    // `keepIds` is never empty here.
    const keepIds = top.map(([relatedProductId]) => relatedProductId);
    await ProductAffinity.destroy({
      where: {
        productId,
        relatedProductId: { [Op.notIn]: keepIds },
      },
    });
  }

  return { productsUpdated: pairCounts.size, pairsUpserted };
}

export async function runProductAffinityTick(): Promise<void> {
  try {
    const result = await runProductAffinityJob();
    if (result.pairsUpserted > 0) {
      logger.info('Product affinity job tick', result);
    }
  } catch (error) {
    logger.warn('Product affinity job tick failed', {
      error: error instanceof Error ? error.message : error,
    });
  }
}

export function startProductAffinityScheduler(): void {
  if (timer) return;
  void runProductAffinityTick();
  timer = setInterval(() => {
    void runProductAffinityTick();
  }, SCHEDULER_INTERVAL_MS);
  logger.info('Product affinity scheduler started', { intervalMs: SCHEDULER_INTERVAL_MS });
}

export function stopProductAffinityScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
