import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { AppError } from '@core/errors/AppError';
import { PRODUCT_STATUS, REVIEW_STATUS } from '@core/constants/statuses';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import {
  deleteS3ObjectByUrl,
  deleteS3ObjectIfReplaced,
} from '@core/s3';
import { productsRepository } from './products.repository';
import { logger } from '@core/logger';
import { Category } from '@database/models/category.model';
import { Vendor } from '@database/models/vendor.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { ProductImage } from '@database/models/productImage.model';
import { Review } from '@database/models/review.model';
import { Product } from '@database/models/product.model';
import { ProductCategory } from '@database/models/productCategory.model';
import { RecentlyViewedItem } from '@database/models/recentlyViewedItem.model';
import { ProductAffinity } from '@database/models/productAffinity.model';
import { sequelize } from '@database/models';
import { categoriesService } from '@modules/categories/categories.service';
import { notificationsService } from '@modules/notifications/notifications.service';
import { findVendorOwnerUserId } from '@modules/notifications/orderNotifications';
import { vendorsService } from '@modules/vendors/vendors.service';
import { shippingService } from '@modules/shipping/shipping.service';
import { logAudit } from '@modules/audit/audit.service';
import type { Transaction } from 'sequelize';
import { resolvePdpPolicy, resolveCodEligibleAtPrice, type PdpPolicy } from './pdpPolicy';
import { productDiscountPercent, productShowMrp, taxInclusivePrice } from '@modules/pricing/displayMoney';
import { taxService } from '@modules/tax/tax.service';
import { gstRuleResolver, priceWithRuleGst } from '@modules/tax/gstPricing';
import { roundMoney, toPaise } from '@modules/pricing/money';
import { gstRateForPieces } from '@modules/pricing/pricing.engine';
import { CreateProductSchema } from './products.dto';
import type {
  CreateProductRequest,
  UpdateProductRequest,
  GetProductsQuery,
  RejectProductRequest,
  AddVariantRequest,
  UpdateVariantRequest,
  AddImageRequest,
  BulkImportRowResult,
} from './products.dto';

/** Cap on how many recently-viewed products a caller can fetch at once. */
const RECENTLY_VIEWED_LIMIT = 12;

/** Matches TOP_N_RELATED in productAffinity.processor.ts — that's how many rows exist per product anyway. */
const FREQUENTLY_BOUGHT_TOGETHER_LIMIT = 10;

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function mapProductResponse(product: Product, reviewCount = 0) {
  const plain: any = typeof product.get === 'function' ? product.get({ plain: true }) : product;
  const primaryImage =
    plain.images?.find((img: any) => img.isPrimary)?.url || plain.images?.[0]?.url || plain.imageUrl || '';
  // Each variant's GST-inclusive price and "% off" need its tax rule, so the product page
  // (mapDetailResponse) adds them.
  const variants = (plain.variants ?? []).map((variant: any) => ({
    ...variant,
    price: Number(variant.price ?? 0),
    stock: Number(variant.stock ?? 0),
  }));
  const stockFromVariants = variants.reduce((sum: number, variant: { stock: number }) => sum + variant.stock, 0);
  const secondaryCategories = (plain.secondaryCategories ?? []).map((category: any) => ({
    id: category.id,
    name: category.name,
    slug: category.slug,
    status: category.status,
  }));

  const basePrice = roundMoney(plain.basePrice ?? 0);
  const compareAtPrice =
    plain.compareAtPrice != null && plain.compareAtPrice !== '' ? roundMoney(plain.compareAtPrice) : null;
  // What the customer pays for one piece, GST included (kept on the product). The MRP
  // includes GST, so the "% off" compares it with this, not with the pre-GST price.
  const displayPrice = plain.displayPrice != null ? roundMoney(plain.displayPrice) : basePrice;
  // Variants at different prices: the card says "From ₹<lowest>".
  const variantPrices = variants.map((variant: { price: number }) => variant.price);
  const priceRangeMax = variantPrices.length ? roundMoney(Math.max(...variantPrices)) : basePrice;

  return {
    ...plain,
    variants,
    secondaryCategories,
    basePrice,
    compareAtPrice,
    displayPrice,
    discountPercent: productDiscountPercent(displayPrice, compareAtPrice),
    showMrp: productShowMrp(displayPrice, compareAtPrice),
    priceRangeMax,
    hasPriceRange: priceRangeMax > basePrice,
    specs: plain.specs && typeof plain.specs === 'object' ? plain.specs : {},
    highlights: Array.isArray(plain.highlights) ? plain.highlights : [],
    brand: plain.brand ?? null,
    deliveryNote: plain.deliveryNote ?? null,
    returnNote: plain.returnNote ?? null,
    avgRating: Number(plain.avgRating ?? 0),
    reviewCount: Number(plain.reviewCount ?? reviewCount ?? 0),
    stock: Number(plain.stock ?? stockFromVariants),
    imageUrl: primaryImage,
    vendor: plain.vendor ?? plain.Vendor ?? null,
    category: plain.category ?? plain.Category ?? null,
    categoryName: plain.category?.name ?? plain.Category?.name ?? plain.categoryName,
    vendorName:
      plain.vendor?.businessName ?? plain.Vendor?.businessName ?? plain.vendorName ?? null,
  };
}

/**
 * The GST rate and GST-inclusive price the product page shows for one piece at `price`:
 * a category with a price band charges by the value of the piece.
 */
export function pdpTaxAtPrice(
  policy: Pick<PdpPolicy, 'gstPercentage' | 'gstPriceBand' | 'taxInclusive'>,
  price: number,
): { gstPercentage: number; taxInclusivePrice: number | null } {
  const gstPercentage = gstRateForPieces(policy.gstPercentage, policy.gstPriceBand, toPaise(price), 1);
  return { gstPercentage, taxInclusivePrice: taxInclusivePrice(price, gstPercentage, policy.taxInclusive) };
}

/**
 * What the customer pays for one piece at `price`, GST included (at the band rate for a
 * banded category), and its "% off" against the MRP, which includes GST.
 */
export function pdpDisplayPricing(
  policy: Pick<PdpPolicy, 'gstPercentage' | 'gstPriceBand'>,
  price: number,
  compareAtPrice: number | null,
): { displayPrice: number; discountPercent: number | null; showMrp: boolean } {
  const displayPrice = priceWithRuleGst(policy, price);
  return {
    displayPrice,
    discountPercent: productDiscountPercent(displayPrice, compareAtPrice),
    showMrp: productShowMrp(displayPrice, compareAtPrice),
  };
}

async function mapDetailResponse(product: Product, reviewCount = 0) {
  const mapped = mapProductResponse(product, reviewCount);
  const vendorId = mapped.vendorId ?? mapped.vendor?.id ?? null;
  // The free-shipping promise the product page shows, resolved from the rates that
  // apply to the seller (the platform-wide ones for a platform product). Null: none.
  const vendorFreeShippingThreshold = await shippingService.getVendorFreeShippingThreshold(vendorId);
  const policy = await resolvePdpPolicy(product);
  const vendor = mapped.vendor
    ? {
        ...mapped.vendor,
        performanceScore: policy.vendorPerformanceScore,
      }
    : mapped.vendor;
  const catalogProduct = {
    categoryId: mapped.categoryId ?? product.categoryId ?? null,
    codEnabled: product.codEnabled ?? null,
    vendor,
  };
  const variants = await Promise.all(
    mapped.variants.map(async (variant: { id: string; price: number; stock: number }) => {
      // This variant's price as the customer pays it (GST included), its "% off", and its
      // own GST rate (the page shows the selected variant's price).
      const display = pdpDisplayPricing(policy, variant.price, mapped.compareAtPrice);
      return {
        ...variant,
        // COD limits are on what the customer pays.
        codEligibleAtUnitPrice: policy.codEnabled
          ? await resolveCodEligibleAtPrice(catalogProduct, display.displayPrice)
          : false,
        ...pdpTaxAtPrice(policy, variant.price),
        ...display,
      };
    }),
  );
  const productDisplay = pdpDisplayPricing(policy, mapped.basePrice, mapped.compareAtPrice);
  const defaultVariant = variants[0];
  return {
    ...mapped,
    ...productDisplay,
    variants,
    vendor,
    vendorFreeShippingThreshold,
    returnsAllowed: policy.returnsAllowed,
    returnWindowDays: policy.returnWindowDays,
    returnShippingFee: policy.returnShippingFee,
    // The rate at the listed price (a banded category charges by the price of the piece).
    gstPercentage: pdpTaxAtPrice(policy, mapped.basePrice).gstPercentage,
    displayHsnCode: policy.hsnCode,
    taxInclusive: policy.taxInclusive,
    codAvailable: policy.codEnabled,
    /** Unit price meets COD min/max — checkout `codAvailable` uses cart grand total instead. */
    codEligibleAtUnitPrice: defaultVariant
      ? defaultVariant.codEligibleAtUnitPrice
      : policy.codEnabled
        ? await resolveCodEligibleAtPrice(catalogProduct, productDisplay.displayPrice)
        : false,
    codMinOrderValue: policy.codMinOrderValue,
    codMaxOrderValue: policy.codMaxOrderValue,
    displayWarrantyMonths: policy.warrantyMonths,
    displayWarrantyType: policy.warrantyType,
    vendorPerformanceScore: policy.vendorPerformanceScore,
    taxInclusivePrice: pdpTaxAtPrice(policy, mapped.basePrice).taxInclusivePrice,
  };
}

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

export { gstRuleResolver, priceWithRuleGst, type GstRateRule } from '@modules/tax/gstPricing';

/**
 * The MRP includes GST, so it may not be below what the customer pays: the listed
 * (pre-GST) price with GST at the category's rate.
 */
async function assertMrpCoversGstPrice(
  categoryId: string | null,
  basePrice: unknown,
  compareAtPrice: number | null,
): Promise<void> {
  if (compareAtPrice == null) return;
  if (roundMoney(compareAtPrice) < (await productDisplayPrice(categoryId, basePrice))) {
    throw new ValidationError(ERROR_MESSAGES.PRODUCT_COMPARE_AT_BELOW_PRICE_WITH_GST);
  }
}

export async function refreshProductDisplayPrice(productId: string, transaction?: Transaction): Promise<void> {
  const product = await Product.findByPk(productId, {
    attributes: ['id', 'categoryId', 'basePrice', 'displayPrice'],
    transaction,
  });
  if (!product) return;
  const displayPrice = await productDisplayPrice(product.categoryId ?? null, product.basePrice);
  if (product.displayPrice == null || roundMoney(product.displayPrice) !== displayPrice) {
    await product.update({ displayPrice }, { transaction });
  }
}

/**
 * Recompute every product's displayed price — after a tax rule changes, which can move
 * the GST on any category below it. Rules are resolved once per category.
 */
export async function refreshAllProductDisplayPrices(): Promise<number> {
  const ruleFor = gstRuleResolver();
  let changed = 0;
  let offset = 0;
  const pageSize = 500;
  for (;;) {
    const page = await Product.unscoped().findAll({
      attributes: ['id', 'categoryId', 'basePrice', 'displayPrice'],
      order: [['id', 'ASC']],
      limit: pageSize,
      offset,
    });
    if (page.length === 0) break;
    for (const product of page) {
      const displayPrice = priceWithRuleGst(await ruleFor(product.categoryId), product.basePrice);
      if (product.displayPrice == null || roundMoney(product.displayPrice) !== displayPrice) {
        await product.update({ displayPrice });
        changed += 1;
      }
    }
    offset += page.length;
  }
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

async function syncSecondaryCategories(
  productId: string,
  primaryCategoryId: string,
  secondaryCategoryIds: string[],
  transaction: Transaction,
) {
  const uniqueIds = [...new Set(secondaryCategoryIds.filter((id) => id !== primaryCategoryId))];
  for (const categoryId of uniqueIds) {
    await categoriesService.assertActiveCategory(categoryId, transaction);
  }

  await ProductCategory.destroy({ where: { productId }, transaction, force: true });
  if (!uniqueIds.length) return;

  await ProductCategory.bulkCreate(
    uniqueIds.map((categoryId) => ({ productId, categoryId })),
    { transaction },
  );
}

export class ProductsService {
  async createProduct(vendorId: string | null, data: CreateProductRequest) {
    return sequelize.transaction(async (t) => {
      const slug = generateSlug(data.name);
      const { secondaryCategoryIds = [], ...productFields } = data;

      const existing = await productsRepository.findBySlug(slug);
      if (existing) {
        throw new ValidationError(ERROR_MESSAGES.PRODUCT_NAME_EXISTS);
      }

      await categoriesService.assertActiveCategory(data.categoryId, t);
      await assertMrpCoversGstPrice(data.categoryId, data.basePrice, data.compareAtPrice ?? null);

      const product = await productsRepository.create({
        ...productFields,
        slug,
        vendorId,
        status: PRODUCT_STATUS.DRAFT,
        avgRating: 0,
      }, { transaction: t });

      await syncSecondaryCategories(product.id, data.categoryId, secondaryCategoryIds, t);
      await refreshProductDisplayPrice(product.id, t);

      return this.getProductById(product.id);
    });
  }

  /**
   * Synchronous vendor CSV bulk import. Each row is validated against
   * CreateProductSchema and created independently (via the same createProduct
   * path as the single-product endpoint) so one bad row doesn't abort the batch.
   */
  async bulkImportProducts(
    vendorId: string | null,
    rows: Record<string, unknown>[],
  ): Promise<BulkImportRowResult[]> {
    const results: BulkImportRowResult[] = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 2; // +1 for 0-index, +1 for the header row
      const parsed = CreateProductSchema.safeParse(rows[i]);

      if (!parsed.success) {
        results.push({
          row: rowNumber,
          success: false,
          error: parsed.error.issues.map((issue) => issue.message).join('; '),
        });
        continue;
      }

      try {
        const product = await this.createProduct(vendorId, parsed.data);
        results.push({ row: rowNumber, success: true, productId: product.id });
      } catch (err) {
        const message = err instanceof AppError ? err.message : 'Failed to create product';
        results.push({ row: rowNumber, success: false, error: message });
      }
    }

    return results;
  }

  /**
   * What a customer pays for one piece at a pre-GST `price` in a category (GST included)
   * and the GST rate charged — for the vendor product form. The rate is the band rate
   * when the price is above the category's band.
   */
  async gstPreview(categoryId: string, price: number): Promise<{ gstPercentage: number; displayPrice: number }> {
    const rule = await taxService.getGstRateRule(categoryId);
    return {
      gstPercentage: gstRateForPieces(rule.gstPercentage, rule.gstPriceBand, toPaise(roundMoney(price)), 1),
      displayPrice: priceWithRuleGst(rule, price),
    };
  }

  async getProducts(
    query: GetProductsQuery,
    options: {
      customerFacing?: boolean;
      includeDescendants?: boolean;
      attributeFilters?: Record<string, string[]>;
    } = {},
  ) {
    // Category-driven browse must not surface ARCHIVED taxonomy nodes.
    if (options.customerFacing && query.categoryId) {
      await categoriesService.assertBrowseableCategory(query.categoryId);
    }

    const offset = paginationOffset(query.page, query.limit);
    let categoryIds: string[] | undefined;
    if (query.categoryId && options.includeDescendants) {
      const { categoriesRepository } = await import('../categories/categories.repository');
      categoryIds = await categoriesRepository.findDescendantIds(query.categoryId);
    }

    let productIds: string[] | undefined;
    const attributeFilters = options.attributeFilters ?? {};
    if (query.categoryId && Object.keys(attributeFilters).length > 0) {
      const ids = await categoriesService.findVisibleProductIdsForFacets(
        categoryIds ?? [query.categoryId],
        query.categoryId,
        attributeFilters,
      );
      if (ids !== null) {
        if (ids.length === 0) {
          return {
            products: [],
            pagination: buildPaginationMeta(0, query.page, query.limit),
          };
        }
        productIds = ids;
      }
    }

    const filters = {
      categoryId: categoryIds ? undefined : query.categoryId,
      categoryIds,
      productIds,
      vendorId: query.vendorId,
      status: query.status,
      search: query.search,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      rating: query.rating,
      sort: query.sort,
      excludeProductId: query.excludeProductId,
      limit: query.limit,
      offset,
    };

    const { rows, count } = options.customerFacing
      ? await productsRepository.findVisibleList(filters)
      : await productsRepository.findWithFilters(filters);

    const mappedProducts = rows.map((p) => mapProductResponse(p));

    return {
      products: mappedProducts,
      pagination: buildPaginationMeta(count, query.page, query.limit),
    };
  }

  async getProductById(id: string, options: { customerFacing?: boolean } = {}) {
    const product = options.customerFacing
      ? await productsRepository.findVisibleById(id)
      : await productsRepository.findById(id, {
          include: [
            'variants',
            'images',
            {
              model: Category,
              include: [
                {
                  association: 'parent',
                  required: false,
                  include: [{ association: 'parent', required: false }],
                },
              ],
            },
            {
              association: 'secondaryCategories',
              attributes: ['id', 'name', 'slug', 'status'],
              through: { attributes: [] },
              required: false,
            },
            { model: Vendor, as: 'vendor' },
          ],
        });
    if (!product) throw new NotFoundError('Product');
    const reviewCount = await Review.count({
      where: { productId: product.id, status: REVIEW_STATUS.APPROVED },
    });
    return mapDetailResponse(product, reviewCount);
  }

  async getProductBySlug(slug: string, options: { customerFacing?: boolean } = {}) {
    const product = options.customerFacing
      ? await productsRepository.findVisibleBySlug(slug)
      : await productsRepository.findBySlug(slug);
    if (!product) throw new NotFoundError('Product');
    const reviewCount = await Review.count({
      where: { productId: product.id, status: REVIEW_STATUS.APPROVED },
    });
    return mapDetailResponse(product, reviewCount);
  }

  /** Upserts the caller's view of a product so a repeat view refreshes recency instead of duplicating. */
  async trackRecentlyViewed(userId: string, productId: string) {
    const product = await productsRepository.findVisibleById(productId);
    if (!product) throw new NotFoundError('Product');

    await RecentlyViewedItem.upsert({
      userId,
      productId,
      viewedAt: new Date(),
    });
  }

  /** Most recently viewed products for the caller, shaped like the product list response. */
  async getRecentlyViewedProducts(userId: string, limit = RECENTLY_VIEWED_LIMIT) {
    const rows = await RecentlyViewedItem.findAll({
      where: { userId },
      order: [['viewedAt', 'DESC']],
      limit,
    });
    if (!rows.length) return [];

    const productIds = rows.map((row) => row.productId);
    const products = await productsRepository.findVisibleByIds(productIds);
    const byId = new Map(products.map((product) => [product.id, product]));

    return productIds
      .map((id) => byId.get(id))
      .filter((product): product is Product => Boolean(product))
      .map((product) => mapProductResponse(product));
  }

  /**
   * "Frequently bought together" — reads only the precomputed product_affinities table
   * (refreshed nightly by productAffinity.processor.ts), no live order join. Public, no auth.
   */
  async getFrequentlyBoughtTogether(productId: string, limit = FREQUENTLY_BOUGHT_TOGETHER_LIMIT) {
    const rows = await ProductAffinity.findAll({
      where: { productId },
      order: [['score', 'DESC']],
      limit,
    });
    if (!rows.length) return [];

    const relatedIds = rows.map((row) => row.relatedProductId);
    const products = await productsRepository.findVisibleByIds(relatedIds);
    const byId = new Map(products.map((product) => [product.id, product]));

    return relatedIds
      .map((id) => byId.get(id))
      .filter((product): product is Product => Boolean(product))
      .map((product) => mapProductResponse(product));
  }

  async updateProduct(id: string, vendorId: string | null, data: UpdateProductRequest) {
    await sequelize.transaction(async (t) => {
      const product = await productsRepository.findById(id, { transaction: t });
      if (!product) throw new NotFoundError('Product');

      if (vendorId && product.vendorId !== vendorId) {
        throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_PRODUCT);
      }

      const { secondaryCategoryIds, ...productFields } = data;

      if (productFields.categoryId) {
        await categoriesService.assertActiveCategory(productFields.categoryId, t);
      }

      const updateData: Record<string, unknown> = { ...productFields };

      const nextBasePrice =
        productFields.basePrice != null ? Number(productFields.basePrice) : Number(product.basePrice);
      const nextCompareAt =
        productFields.compareAtPrice !== undefined
          ? productFields.compareAtPrice == null
            ? null
            : Number(productFields.compareAtPrice)
          : product.compareAtPrice == null
            ? null
            : Number(product.compareAtPrice);
      if (nextCompareAt != null && nextCompareAt < nextBasePrice) {
        throw new ValidationError(ERROR_MESSAGES.PRODUCT_COMPARE_AT_BELOW_PRICE);
      }
      // Checked when the price, MRP or category (its GST rate) changes.
      if (
        productFields.basePrice != null ||
        productFields.compareAtPrice !== undefined ||
        productFields.categoryId !== undefined
      ) {
        await assertMrpCoversGstPrice(productFields.categoryId ?? product.categoryId, nextBasePrice, nextCompareAt);
      }

      if (productFields.name) {
        const slug = generateSlug(productFields.name);
        const existing = await productsRepository.findBySlug(slug);
        if (existing && existing.id !== id) {
          throw new ValidationError(ERROR_MESSAGES.PRODUCT_NAME_EXISTS);
        }
        updateData.slug = slug;
      }

      if (Object.keys(updateData).length) {
        await productsRepository.update(id, updateData, { transaction: t });
      }
      // A product with variants lists its lowest variant price, whatever was sent.
      if (updateData.basePrice !== undefined) await syncProductBasePrice(id, t);
      // A new category can mean a different GST rate on the displayed price.
      else if (updateData.categoryId !== undefined) await refreshProductDisplayPrice(id, t);

      const primaryCategoryId = productFields.categoryId ?? product.categoryId;
      if (secondaryCategoryIds !== undefined) {
        await syncSecondaryCategories(id, primaryCategoryId, secondaryCategoryIds, t);
      }

      const nextStatus =
        (typeof updateData.status === 'string' ? updateData.status : null) ?? product.status;
      const isLiveOrPending =
        nextStatus === PRODUCT_STATUS.LIVE || nextStatus === PRODUCT_STATUS.PENDING_APPROVAL;
      const ownerVendorId = product.vendorId;
      if (isLiveOrPending && ownerVendorId) {
        let secondaryIds: string[];
        if (secondaryCategoryIds !== undefined) {
          secondaryIds = secondaryCategoryIds.filter((cid) => cid !== primaryCategoryId);
        } else {
          const secondary = await ProductCategory.findAll({
            where: { productId: id },
            attributes: ['categoryId'],
            transaction: t,
          });
          secondaryIds = secondary.map((link) => link.categoryId);
        }
        await vendorsService.assertCategoriesKycSatisfied(ownerVendorId, [
          primaryCategoryId,
          ...secondaryIds,
        ]);
      }
    });

    return this.getProductById(id);
  }

  async deleteProduct(id: string, vendorId: string | null) {
    await sequelize.transaction(async (t) => {
      const product = await productsRepository.findById(id, { transaction: t });
      if (!product) throw new NotFoundError('Product');

      if (vendorId && product.vendorId !== vendorId) {
        throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_PRODUCT);
      }

      // Soft-delete the product only. Keep ProductImage rows and S3 objects so
      // historical order views can still live-join thumbnails. Hard-delete/GC
      // of orphaned media is out of scope for this path.
      await productsRepository.softDelete(id, { transaction: t });
    });
  }

  async submitForApproval(id: string, vendorId: string) {
    await sequelize.transaction(async (t) => {
      const product = await productsRepository.findById(id, { transaction: t });
      if (!product) throw new NotFoundError('Product');

      if (product.vendorId !== vendorId) {
        throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_PRODUCT);
      }

      if (product.status !== PRODUCT_STATUS.DRAFT) {
        throw new ValidationError(ERROR_MESSAGES.PRODUCT_NOT_DRAFT);
      }

      const variantCount = await ProductVariant.count({ where: { productId: id }, transaction: t });
      if (variantCount === 0) {
        throw new ValidationError('Cannot submit product for approval without at least one variant.');
      }

      const imageCount = await ProductImage.count({ where: { productId: id }, transaction: t });
      if (imageCount === 0) {
        throw new ValidationError('Cannot submit product for approval without at least one image.');
      }

      const secondary = await ProductCategory.findAll({
        where: { productId: id },
        attributes: ['categoryId'],
        transaction: t,
      });
      const categoryIds = [
        product.categoryId,
        ...secondary.map((row) => row.categoryId),
      ].filter(Boolean);
      await vendorsService.assertCategoriesKycSatisfied(vendorId, categoryIds);

      await productsRepository.update(id, { status: PRODUCT_STATUS.PENDING_APPROVAL }, { transaction: t });
    });

    return this.getProductById(id);
  }

  async approveProduct(id: string, adminId: string) {
    await sequelize.transaction(async (t) => {
      const row = await productsRepository.findById(id, { transaction: t });
      if (!row) throw new NotFoundError('Product');

      if (row.status !== PRODUCT_STATUS.PENDING_APPROVAL) {
        throw new ValidationError(ERROR_MESSAGES.PRODUCT_NOT_PENDING_APPROVAL);
      }

      const variantCount = await ProductVariant.count({ where: { productId: id }, transaction: t });
      if (variantCount === 0) {
        throw new ValidationError('Cannot approve product without at least one variant.');
      }

      const imageCount = await ProductImage.count({ where: { productId: id }, transaction: t });
      if (imageCount === 0) {
        throw new ValidationError('Cannot approve product without at least one image.');
      }

      const secondary = await ProductCategory.findAll({
        where: { productId: id },
        attributes: ['categoryId'],
        transaction: t,
      });
      const categoryIds = [
        row.categoryId,
        ...secondary.map((link) => link.categoryId),
      ].filter(Boolean);
      if (!row.vendorId) {
        throw new AppError(
          ERROR_MESSAGES.VENDOR_KYC_BLOCKS_PRODUCT,
          422,
          ERROR_CODES.VENDOR_KYC_BLOCKS_PRODUCT,
        );
      }
      await vendorsService.assertCategoriesKycSatisfied(row.vendorId, categoryIds);

      await productsRepository.update(id, {
        status: PRODUCT_STATUS.LIVE,
        approvedById: adminId,
        rejectionNote: null,
      }, { transaction: t });
    });

    const product = await this.getProductById(id);

    await logAudit({
      actorId: adminId,
      action: 'PRODUCT_APPROVED',
      entityType: 'Product',
      entityId: id,
      metadata: { name: product.name },
    });

    const ownerId = await findVendorOwnerUserId(product.vendorId);
    if (ownerId) {
      void notificationsService.sendProductApproved(ownerId, product.id, {
        productName: product.name,
      });
    }
    return product;
  }

  async rejectProduct(id: string, data: RejectProductRequest, actorId?: string) {
    await sequelize.transaction(async (t) => {
      const row = await productsRepository.findById(id, { transaction: t });
      if (!row) throw new NotFoundError('Product');

      if (row.status !== PRODUCT_STATUS.PENDING_APPROVAL) {
        throw new ValidationError(ERROR_MESSAGES.PRODUCT_NOT_PENDING_APPROVAL);
      }

      await productsRepository.update(id, {
        status: PRODUCT_STATUS.REJECTED,
        rejectionNote: data.rejectionNote,
      }, { transaction: t });
    });

    const product = await this.getProductById(id);

    if (actorId) {
      await logAudit({
        actorId,
        action: 'PRODUCT_REJECTED',
        entityType: 'Product',
        entityId: id,
        metadata: { name: product.name, rejectionNote: data.rejectionNote },
      });
    }

    const ownerId = await findVendorOwnerUserId(product.vendorId);
    if (ownerId) {
      void notificationsService.sendProductRejected(ownerId, product.id, {
        productName: product.name,
        reason: data.rejectionNote,
      });
    }
    return product;
  }

  async archiveProduct(id: string, actorId?: string) {
    return sequelize.transaction(async (t) => {
      const product = await productsRepository.findById(id, { transaction: t });
      if (!product) throw new NotFoundError('Product');

      await productsRepository.update(id, { status: PRODUCT_STATUS.ARCHIVED }, { transaction: t });

      if (actorId) {
        await logAudit({
          actorId,
          action: 'PRODUCT_ARCHIVED',
          entityType: 'Product',
          entityId: id,
          metadata: { name: product.name },
          transaction: t,
        });
      }

      return this.getProductById(id);
    });
  }

  async unarchiveProduct(id: string, actorId?: string) {
    return sequelize.transaction(async (t) => {
      const product = await productsRepository.findById(id, { transaction: t });
      if (!product) throw new NotFoundError('Product');
      if (product.status !== PRODUCT_STATUS.ARCHIVED) {
        throw new ValidationError('Only archived products can be unarchived');
      }

      await productsRepository.update(id, { status: PRODUCT_STATUS.DRAFT }, { transaction: t });

      if (actorId) {
        await logAudit({
          actorId,
          action: 'PRODUCT_UNARCHIVED',
          entityType: 'Product',
          entityId: id,
          metadata: { name: product.name, restoredStatus: PRODUCT_STATUS.DRAFT },
          transaction: t,
        });
      }

      return this.getProductById(id);
    });
  }

  // Variant management
  async addVariant(productId: string, data: AddVariantRequest) {
    return sequelize.transaction(async (t) => {
      const product = await productsRepository.findById(productId, { transaction: t });
      if (!product) throw new NotFoundError('Product');

      const existing = await ProductVariant.findOne({ where: { sku: data.sku } });
      if (existing) {
        throw new ValidationError('SKU already exists');
      }

      const variant = await ProductVariant.create({
        productId,
        ...data,
      }, { transaction: t });
      await syncProductBasePrice(productId, t);

      return variant;
    });
  }

  async updateVariant(variantId: string, data: UpdateVariantRequest) {
    return sequelize.transaction(async (t) => {
      const variant = await ProductVariant.findByPk(variantId, { transaction: t });
      if (!variant) throw new NotFoundError('ProductVariant');

      await variant.update(data, { transaction: t });
      if (data.price !== undefined) await syncProductBasePrice(variant.productId, t);
      return variant;
    });
  }

  async deleteVariant(variantId: string) {
    return sequelize.transaction(async (t) => {
      const variant = await ProductVariant.findByPk(variantId, { transaction: t });
      if (!variant) throw new NotFoundError('ProductVariant');

      // Hard delete variants - they're detail records
      await variant.destroy({ transaction: t });
      await syncProductBasePrice(variant.productId, t);
    });
  }

  // Image management
  async addImage(productId: string, data: AddImageRequest) {
    return sequelize.transaction(async (t) => {
      const product = await productsRepository.findById(productId, { transaction: t });
      if (!product) throw new NotFoundError('Product');

      if (data.isPrimary) {
        await ProductImage.update({ isPrimary: false }, { where: { productId }, transaction: t });
      }

      if (data.variantId) {
        const variant = await ProductVariant.findByPk(data.variantId, { transaction: t });
        if (!variant || variant.productId !== productId) {
          throw new ValidationError(ERROR_MESSAGES.PRODUCT_VARIANT_INVALID);
        }
      }

      const image = await ProductImage.create({
        productId,
        url: data.url,
        isPrimary: data.isPrimary,
        variantId: data.variantId ?? null,
      }, { transaction: t });

      return image;
    });
  }

  async deleteImage(imageId: string) {
    const image = await sequelize.transaction(async (t) => {
      const row = await ProductImage.findByPk(imageId, { transaction: t });
      if (!row) throw new NotFoundError('ProductImage');
      await row.destroy({ transaction: t });
      return row;
    });
    await deleteS3ObjectByUrl(image.url);
  }

  /** Phase 2 replace — swaps image URL and deletes the previous S3 object. */
  async replaceImage(imageId: string, data: { url: string; isPrimary?: boolean }) {
    const previousUrl = await sequelize.transaction(async (t) => {
      const image = await ProductImage.findByPk(imageId, { transaction: t });
      if (!image) throw new NotFoundError('ProductImage');

      const previous = image.url;
      if (data.isPrimary) {
        await ProductImage.update(
          { isPrimary: false },
          { where: { productId: image.productId }, transaction: t },
        );
      }
      await image.update(
        {
          url: data.url,
          ...(data.isPrimary !== undefined ? { isPrimary: data.isPrimary } : {}),
        },
        { transaction: t },
      );
      return previous;
    });

    await deleteS3ObjectIfReplaced(previousUrl, data.url);
    const updated = await ProductImage.findByPk(imageId);
    return updated!;
  }

  async setPrimaryImage(imageId: string) {
    return sequelize.transaction(async (t) => {
      const image = await ProductImage.findByPk(imageId, { transaction: t });
      if (!image) throw new NotFoundError('ProductImage');

      await ProductImage.update({ isPrimary: false }, { where: { productId: image.productId }, transaction: t });
      await image.update({ isPrimary: true }, { transaction: t });

      return image;
    });
  }
}

export const productsService = new ProductsService();
