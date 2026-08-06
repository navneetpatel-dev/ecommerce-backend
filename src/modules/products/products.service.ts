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
import { sequelize } from '@database/models';
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

  return {
    ...plain,
    variants,
    basePrice: Number(plain.basePrice ?? 0),
    avgRating: Number(plain.avgRating ?? 0),
    reviewCount: Number(plain.reviewCount ?? reviewCount ?? 0),
    stock: Number(plain.stock ?? stockFromVariants),
    imageUrl: primaryImage,
    vendor: plain.vendor ?? plain.Vendor ?? null,
    category: plain.category ?? plain.Category ?? null,
    categoryName: plain.category?.name ?? plain.Category?.name ?? plain.categoryName,
  };
}

export class ProductsService {
  async createProduct(vendorId: string | null, data: CreateProductRequest) {
    return sequelize.transaction(async (t) => {
      const slug = generateSlug(data.name);
      
      const existing = await productsRepository.findBySlug(slug);
      if (existing) {
        throw new ValidationError(ERROR_MESSAGES.PRODUCT_NAME_EXISTS);
      }

      const product = await productsRepository.create({
        ...data,
        slug,
        vendorId,
        status: PRODUCT_STATUS.DRAFT,
        avgRating: 0,
      }, { transaction: t });

      return product;
    });
  }

  async getProducts(query: GetProductsQuery, options: { customerFacing?: boolean } = {}) {
    const offset = paginationOffset(query.page, query.limit);
    const filters = {
      categoryId: query.categoryId,
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
          include: ['variants', 'images', { model: Category }, { model: Vendor, as: 'vendor' }],
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

      const updateData: any = { ...data };

      if (data.name) {
        const slug = generateSlug(data.name);
        const existing = await productsRepository.findBySlug(slug);
        if (existing && existing.id !== id) {
          throw new ValidationError(ERROR_MESSAGES.PRODUCT_NAME_EXISTS);
        }
        updateData.slug = slug;
      }

      await productsRepository.update(id, updateData, { transaction: t });
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
    return sequelize.transaction(async (t) => {
      const product = await productsRepository.findById(id, { transaction: t });
      if (!product) throw new NotFoundError('Product');

      if (product.status !== PRODUCT_STATUS.PENDING_APPROVAL) {
        throw new ValidationError('Product is not pending approval');
      }

      await productsRepository.update(id, {
        status: PRODUCT_STATUS.LIVE,
        approvedById: adminId,
        rejectionNote: null,
      }, { transaction: t });
      return this.getProductById(id);
    });
  }

  async rejectProduct(id: string, data: RejectProductRequest) {
    return sequelize.transaction(async (t) => {
      const product = await productsRepository.findById(id, { transaction: t });
      if (!product) throw new NotFoundError('Product');

      if (product.status !== PRODUCT_STATUS.PENDING_APPROVAL) {
        throw new ValidationError('Product is not pending approval');
      }

      await productsRepository.update(id, {
        status: PRODUCT_STATUS.REJECTED,
        rejectionNote: data.rejectionNote,
      }, { transaction: t });

      return this.getProductById(id);
    });
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
