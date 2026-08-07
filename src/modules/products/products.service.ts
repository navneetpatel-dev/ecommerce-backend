import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { PRODUCT_STATUS, REVIEW_STATUS } from '@core/constants/statuses';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { productsRepository } from './products.repository';
import { Category } from '@database/models/category.model';
import { Vendor } from '@database/models/vendor.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { ProductImage } from '@database/models/productImage.model';
import { Review } from '@database/models/review.model';
import { Product } from '@database/models/product.model';
import { ProductCategory } from '@database/models/productCategory.model';
import { sequelize } from '@database/models';
import { categoriesService } from '@modules/categories/categories.service';
import { notificationsService } from '@modules/notifications/notifications.service';
import { findVendorOwnerUserId } from '@modules/notifications/orderNotifications';
import type { Transaction } from 'sequelize';
import type {
  CreateProductRequest,
  UpdateProductRequest,
  GetProductsQuery,
  RejectProductRequest,
  AddVariantRequest,
  UpdateVariantRequest,
  AddImageRequest,
} from './products.dto';

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function mapProductResponse(product: Product, reviewCount = 0) {
  const plain: any = typeof product.get === 'function' ? product.get({ plain: true }) : product;
  const primaryImage =
    plain.images?.find((img: any) => img.isPrimary)?.url || plain.images?.[0]?.url || plain.imageUrl || '';
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

  return {
    ...plain,
    variants,
    secondaryCategories,
    basePrice: Number(plain.basePrice ?? 0),
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

      const product = await productsRepository.create({
        ...productFields,
        slug,
        vendorId,
        status: PRODUCT_STATUS.DRAFT,
        avgRating: 0,
      }, { transaction: t });

      await syncSecondaryCategories(product.id, data.categoryId, secondaryCategoryIds, t);

      return this.getProductById(product.id);
    });
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
    return mapProductResponse(product, reviewCount);
  }

  async getProductBySlug(slug: string, options: { customerFacing?: boolean } = {}) {
    const product = options.customerFacing
      ? await productsRepository.findVisibleBySlug(slug)
      : await productsRepository.findBySlug(slug);
    if (!product) throw new NotFoundError('Product');
    return mapProductResponse(product);
  }

  async updateProduct(id: string, vendorId: string | null, data: UpdateProductRequest) {
    return sequelize.transaction(async (t) => {
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

      if (secondaryCategoryIds !== undefined) {
        const primaryCategoryId = productFields.categoryId ?? product.categoryId;
        await syncSecondaryCategories(id, primaryCategoryId, secondaryCategoryIds, t);
      }

      return this.getProductById(id);
    });
  }

  async deleteProduct(id: string, vendorId: string | null) {
    return sequelize.transaction(async (t) => {
      const product = await productsRepository.findById(id, { transaction: t });
      if (!product) throw new NotFoundError('Product');

      if (vendorId && product.vendorId !== vendorId) {
        throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_PRODUCT);
      }

      // Soft delete - can be restored later
      await productsRepository.softDelete(id, { transaction: t });
    });
  }

  async submitForApproval(id: string, vendorId: string) {
    return sequelize.transaction(async (t) => {
      const product = await productsRepository.findById(id, { transaction: t });
      if (!product) throw new NotFoundError('Product');

      if (product.vendorId !== vendorId) {
        throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_PRODUCT);
      }

      if (product.status !== PRODUCT_STATUS.DRAFT) {
        throw new ValidationError('Product is not in DRAFT status');
      }

      await productsRepository.update(id, { status: PRODUCT_STATUS.PENDING_APPROVAL }, { transaction: t });
      return this.getProductById(id);
    });
  }

  async approveProduct(id: string, adminId: string) {
    const product = await sequelize.transaction(async (t) => {
      const row = await productsRepository.findById(id, { transaction: t });
      if (!row) throw new NotFoundError('Product');

      if (row.status !== PRODUCT_STATUS.PENDING_APPROVAL) {
        throw new ValidationError('Product is not pending approval');
      }

      await productsRepository.update(id, {
        status: PRODUCT_STATUS.LIVE,
        approvedById: adminId,
        rejectionNote: null,
      }, { transaction: t });
      return this.getProductById(id);
    });

    const ownerId = await findVendorOwnerUserId(product.vendorId);
    if (ownerId) {
      void notificationsService.sendProductApproved(ownerId, product.id, {
        productName: product.name,
      });
    }
    return product;
  }

  async rejectProduct(id: string, data: RejectProductRequest) {
    const product = await sequelize.transaction(async (t) => {
      const row = await productsRepository.findById(id, { transaction: t });
      if (!row) throw new NotFoundError('Product');

      if (row.status !== PRODUCT_STATUS.PENDING_APPROVAL) {
        throw new ValidationError('Product is not pending approval');
      }

      await productsRepository.update(id, {
        status: PRODUCT_STATUS.REJECTED,
        rejectionNote: data.rejectionNote,
      }, { transaction: t });

      return this.getProductById(id);
    });

    const ownerId = await findVendorOwnerUserId(product.vendorId);
    if (ownerId) {
      void notificationsService.sendProductRejected(ownerId, product.id, {
        productName: product.name,
        reason: data.rejectionNote,
      });
    }
    return product;
  }

  async archiveProduct(id: string) {
    return sequelize.transaction(async (t) => {
      const product = await productsRepository.findById(id, { transaction: t });
      if (!product) throw new NotFoundError('Product');

      await productsRepository.update(id, { status: PRODUCT_STATUS.ARCHIVED }, { transaction: t });
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

      return variant;
    });
  }

  async updateVariant(variantId: string, data: UpdateVariantRequest) {
    return sequelize.transaction(async (t) => {
      const variant = await ProductVariant.findByPk(variantId, { transaction: t });
      if (!variant) throw new NotFoundError('ProductVariant');

      await variant.update(data, { transaction: t });
      return variant;
    });
  }

  async deleteVariant(variantId: string) {
    return sequelize.transaction(async (t) => {
      const variant = await ProductVariant.findByPk(variantId, { transaction: t });
      if (!variant) throw new NotFoundError('ProductVariant');

      // Hard delete variants - they're detail records
      await variant.destroy({ transaction: t });
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

      const image = await ProductImage.create({
        productId,
        ...data,
      }, { transaction: t });

      return image;
    });
  }

  async deleteImage(imageId: string) {
    return sequelize.transaction(async (t) => {
      const image = await ProductImage.findByPk(imageId, { transaction: t });
      if (!image) throw new NotFoundError('ProductImage');

      // Hard delete images - they're detail records
      await image.destroy({ transaction: t });
    });
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
