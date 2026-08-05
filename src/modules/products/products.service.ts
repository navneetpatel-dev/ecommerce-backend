import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { productsRepository } from './products.repository';
import { Category } from '@database/models/category.model';
import { Vendor } from '@database/models/vendor.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { ProductImage } from '@database/models/productImage.model';
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

export class ProductsService {
  async createProduct(vendorId: string | null, data: CreateProductRequest) {
    return sequelize.transaction(async (t) => {
      const slug = generateSlug(data.name);
      
      const existing = await productsRepository.findBySlug(slug);
      if (existing) {
        throw new ValidationError('Product name already exists');
      }

      const product = await productsRepository.create({
        ...data,
        slug,
        vendorId,
        status: 'DRAFT',
        avgRating: 0,
      }, { transaction: t });

      return product;
    });
  }

  async getProducts(query: GetProductsQuery) {
    const offset = (query.page - 1) * query.limit;
    const { rows, count } = await productsRepository.findWithFilters({
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
    });

    const mappedProducts = rows.map((p) => {
      const plain: any = p.get({ plain: true });
      const primaryImage = plain.images?.find((img: any) => img.isPrimary)?.url || plain.images?.[0]?.url || '';
      return {
        ...plain,
        imageUrl: primaryImage,
      };
    });

    return {
      products: mappedProducts,
      pagination: {
        total: count,
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(count / query.limit),
      },
    };
  }

  async getProductById(id: string) {
    const product = await productsRepository.findById(id, {
      include: ['variants', 'images', { model: Category }, { model: Vendor }],
    });
    if (!product) throw new NotFoundError('Product');
    return product;
  }

  async getProductBySlug(slug: string) {
    const product = await productsRepository.findBySlug(slug);
    if (!product) throw new NotFoundError('Product');
    return product;
  }

  async updateProduct(id: string, vendorId: string | null, data: UpdateProductRequest) {
    return sequelize.transaction(async (t) => {
      const product = await productsRepository.findById(id, { transaction: t });
      if (!product) throw new NotFoundError('Product');

      if (vendorId && product.vendorId !== vendorId) {
        throw new ForbiddenError('Not your product');
      }

      const updateData: any = { ...data };

      if (data.name) {
        const slug = generateSlug(data.name);
        const existing = await productsRepository.findBySlug(slug);
        if (existing && existing.id !== id) {
          throw new ValidationError('Product name already exists');
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
        throw new ForbiddenError('Not your product');
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
        throw new ForbiddenError('Not your product');
      }

      if (product.status !== 'DRAFT') {
        throw new ValidationError('Product is not in DRAFT status');
      }

      await productsRepository.update(id, { status: 'PENDING_APPROVAL' }, { transaction: t });
      return this.getProductById(id);
    });
  }

  async approveProduct(id: string, adminId: string) {
    return sequelize.transaction(async (t) => {
      const product = await productsRepository.findById(id, { transaction: t });
      if (!product) throw new NotFoundError('Product');

      if (product.status !== 'PENDING_APPROVAL') {
        throw new ValidationError('Product is not pending approval');
      }

      await productsRepository.update(id, { status: 'LIVE', approvedById: adminId }, { transaction: t });
      return this.getProductById(id);
    });
  }

  async rejectProduct(id: string, data: RejectProductRequest) {
    return sequelize.transaction(async (t) => {
      const product = await productsRepository.findById(id, { transaction: t });
      if (!product) throw new NotFoundError('Product');

      if (product.status !== 'PENDING_APPROVAL') {
        throw new ValidationError('Product is not pending approval');
      }

      await productsRepository.update(id, {
        status: 'REJECTED',
        rejectionNote: data.rejectionNote,
      }, { transaction: t });

      return this.getProductById(id);
    });
  }

  async archiveProduct(id: string) {
    return sequelize.transaction(async (t) => {
      const product = await productsRepository.findById(id, { transaction: t });
      if (!product) throw new NotFoundError('Product');

      await productsRepository.update(id, { status: 'ARCHIVED' }, { transaction: t });
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
