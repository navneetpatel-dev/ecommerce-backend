import { Op, type Transaction } from 'sequelize';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { logger } from '@core/logger';
import { Product } from '@database/models/product.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { taxService } from '@modules/tax/tax.service';
import { gstRuleResolver, isAboveMrp, priceWithRuleGst, type GstRateRule } from '@modules/tax/gstPricing';
import { PRODUCT_STATUS } from '@core/constants/statuses';
import { notifyAboveMrp, type BlockedListing } from '@modules/notifications/events/catalogEvents';
import { roundMoney, toPaise } from '@modules/pricing/money';

/** The prices a product shows and sells at, kept in step with its variants and its tax rule. */

/**
 * A product's listed price is the lowest price any of its variants sells at, so the
 * card, search, price filter and price sort never show a figure nobody can buy at.
 * Kept in step whenever variants change; a product with no variants keeps its own.
 */
export async function syncProductBasePrice(productId: string, transaction: Transaction): Promise<void> {
  const lowest = await ProductVariant.min<number, ProductVariant>('price', {
    where: { productId },
    transaction,
  });
  if (lowest != null && Number.isFinite(Number(lowest))) {
    const product = await Product.findByPk(productId, { attributes: ['id', 'basePrice'], transaction });
    if (product && roundMoney(product.basePrice) !== roundMoney(lowest)) {
      await product.update({ basePrice: roundMoney(lowest) }, { transaction });
    }
  }
  await refreshProductDisplayPrice(productId, transaction);
}

/**
 * The price customers see for a product: its listed (lowest) price with GST at its
 * category's rate — the band rate for that price when the rule has one. Stored so the
 * price filter and sort work on the same figure the cards show.
 */
export async function productDisplayPrice(categoryId: string | null, basePrice: unknown): Promise<number> {
  return priceWithRuleGst(await taxService.getGstRateRule(categoryId ?? undefined), basePrice);
}

/**
 * The MRP includes GST and is printed for the product, so no piece may sell above it:
 * every price it is sold at (each variant's, or the product's own without variants),
 * with GST at the category's rate — the band rate for a piece above the band — must be
 * within it.
 */
export async function assertMrpCoversGstPrices(
  categoryId: string | null,
  prices: unknown[],
  compareAtPrice: number | null,
  message: string = ERROR_MESSAGES.PRODUCT_COMPARE_AT_BELOW_PRICE_WITH_GST,
): Promise<void> {
  if (compareAtPrice == null || prices.length === 0) return;
  const rule = await taxService.getGstRateRule(categoryId ?? undefined);
  const mrpPaise = toPaise(roundMoney(compareAtPrice));
  if (prices.some((price) => toPaise(priceWithRuleGst(rule, price)) > mrpPaise)) {
    throw new ValidationError(message);
  }
}

/** The prices a product sells at: its variants', or its own when it has none. */
export async function sellingPrices(productId: string, ownPrice: unknown, transaction: Transaction): Promise<unknown[]> {
  const variants = await ProductVariant.findAll({ where: { productId }, attributes: ['price'], transaction });
  return variants.length > 0 ? variants.map((variant) => variant.price) : [ownPrice];
}

type StateProduct = Pick<Product, 'id' | 'basePrice' | 'displayPrice' | 'compareAtPrice' | 'aboveMrp'>;

/**
 * Brings a product's displayed price and its "above MRP" flags (each variant's, and the
 * product's when every price it sells at is above) in step with `rule`. Returns the variants
 * that have just become unsellable.
 */
async function applyPricingState(
  product: Product,
  variants: ProductVariant[],
  rule: GstRateRule,
  transaction?: Transaction,
): Promise<{ changed: boolean; newlyAbove: ProductVariant[] }> {
  const mrp = (product as StateProduct).compareAtPrice;
  const newlyAbove: ProductVariant[] = [];
  const flags: boolean[] = [];
  for (const variant of variants) {
    const above = isAboveMrp(rule, variant.price, mrp);
    flags.push(above);
    if (Boolean(variant.aboveMrp) === above) continue;
    // Only the refresh that actually flips the flag reports it: two running at once must not
    // both tell the vendor.
    const [flipped] = await ProductVariant.update(
      { aboveMrp: above },
      { where: { id: variant.id, aboveMrp: !above }, transaction },
    );
    if (above && flipped) newlyAbove.push(variant);
  }
  const displayPrice = priceWithRuleGst(rule, product.basePrice);
  const aboveMrp = flags.length > 0 ? flags.every(Boolean) : isAboveMrp(rule, product.basePrice, mrp);
  const changed =
    product.displayPrice == null || roundMoney(product.displayPrice) !== displayPrice || Boolean(product.aboveMrp) !== aboveMrp;
  if (changed) await product.update({ displayPrice, aboveMrp }, { transaction });
  return { changed: changed || newlyAbove.length > 0, newlyAbove };
}

const STATE_ATTRIBUTES = ['id', 'categoryId', 'vendorId', 'name', 'status', 'basePrice', 'displayPrice', 'compareAtPrice', 'aboveMrp'];

export async function refreshProductDisplayPrice(productId: string, transaction?: Transaction): Promise<void> {
  const product = await Product.findByPk(productId, { attributes: STATE_ATTRIBUTES, transaction });
  if (!product) return;
  const variants = await ProductVariant.findAll({
    where: { productId },
    attributes: ['id', 'price', 'aboveMrp'],
    transaction,
  });
  const rule = await taxService.getGstRateRule(product.categoryId ?? undefined);
  await applyPricingState(product, variants, rule, transaction);
}

/**
 * Recompute every product's displayed price and MRP flags — after a tax rule changes, which can
 * move the GST on any category below it. Rules are resolved once per category. Vendors are told
 * about the options of published listings that can no longer be sold.
 */
export async function refreshAllProductDisplayPrices(): Promise<number> {
  const ruleFor = gstRuleResolver();
  const blocked: BlockedListing[] = [];
  let changed = 0;
  let offset = 0;
  const pageSize = 500;
  for (;;) {
    const page = await Product.unscoped().findAll({
      attributes: STATE_ATTRIBUTES,
      order: [['id', 'ASC']],
      limit: pageSize,
      offset,
    });
    if (page.length === 0) break;
    const variants = await ProductVariant.findAll({
      where: { productId: { [Op.in]: page.map((product) => product.id) } },
      attributes: ['id', 'productId', 'price', 'aboveMrp'],
    });
    for (const product of page) {
      const own = variants.filter((variant) => variant.productId === product.id);
      const state = await applyPricingState(product, own, await ruleFor(product.categoryId));
      if (state.changed) changed += 1;
      const published = product.status === PRODUCT_STATUS.LIVE || product.status === PRODUCT_STATUS.PENDING_APPROVAL;
      if (state.newlyAbove.length > 0 && published && product.vendorId) {
        blocked.push({ vendorId: product.vendorId, productName: product.name, variants: state.newlyAbove.length });
      }
    }
    offset += page.length;
  }
  await notifyAboveMrp(blocked);
  return changed;
}

/**
 * Refresh every product's GST-inclusive price without holding up the request — after a
 * change that can move the GST rule a product falls under (a tax rule edited, a category
 * moved, products moved to another category). Never throws.
 */
export function refreshAllProductDisplayPricesInBackground(trigger: string): void {
  void refreshAllProductDisplayPrices()
    .then((changed) => logger.info('Product display prices refreshed', { trigger, changed }))
    .catch((error) =>
      logger.error('Refreshing product display prices failed', {
        trigger,
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
}
