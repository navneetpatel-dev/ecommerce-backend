import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional, NonAttribute } from 'sequelize';
import type { ProductVariant } from './productVariant.model';
import type { ProductImage } from './productImage.model';
import { PRODUCT_STATUS, VENDOR_STATUS, type ProductStatus } from '@core/constants/statuses';

export class Product extends Model<InferAttributes<Product>, InferCreationAttributes<Product>> {
  declare id: CreationOptional<string>;
  declare vendorId: string | null;
  declare categoryId: string;
  declare name: string;
  declare slug: string;
  declare description: string;
  declare basePrice: number;
  declare compareAtPrice: number | null;
  declare brand: string | null;
  declare specs: CreationOptional<Record<string, string>>;
  declare highlights: CreationOptional<string[]>;
  declare deliveryNote: string | null;
  declare returnNote: string | null;
  declare warrantyMonths: number | null;
  declare warrantyType: string | null;
  declare hsnCode: string | null;
  declare seoTitle: string | null;
  declare seoDescription: string | null;
  declare videoUrl: string | null;
  declare sizeChartUrl: string | null;
  declare codEnabled: boolean | null;
  declare status: ProductStatus;
  declare approvedById: string | null;
  declare rejectionNote: string | null;
  declare tags: CreationOptional<string[]>;
  declare avgRating: CreationOptional<number>;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  declare variants?: NonAttribute<ProductVariant[]>;
  declare images?: NonAttribute<ProductImage[]>;

  static associate(models: Record<string, any>) {
    Product.belongsTo(models.Vendor, { as: 'vendor', foreignKey: 'vendorId' });
    Product.belongsTo(models.Category, { foreignKey: 'categoryId' });
    Product.hasMany(models.ProductVariant, { foreignKey: 'productId', as: 'variants' });
    Product.hasMany(models.ProductImage, { foreignKey: 'productId', as: 'images' });
    Product.belongsToMany(models.Category, {
      through: models.ProductCategory,
      as: 'secondaryCategories',
      foreignKey: 'productId',
      otherKey: 'categoryId',
    });

    // Customer-facing catalog rule — define once; every shopper query uses this scope.
    Product.addScope('customerVisible', {
      where: { status: PRODUCT_STATUS.LIVE },
      include: [
        {
          model: models.Vendor,
          as: 'vendor',
          required: true,
          where: { status: VENDOR_STATUS.APPROVED },
          attributes: ['id', 'businessName', 'slug', 'logoUrl', 'commissionRate', 'performanceScore', 'returnShippingFee', 'codEnabled'],
        },
      ],
    });
  }
}

export const initProductModel = (sequelize: Sequelize) => {
  Product.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      vendorId: { type: DataTypes.UUID, allowNull: true },
      categoryId: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      slug: { type: DataTypes.STRING, unique: true, allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: false },
      basePrice: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      compareAtPrice: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      brand: { type: DataTypes.STRING, allowNull: true },
      specs: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      highlights: { type: DataTypes.ARRAY(DataTypes.TEXT), allowNull: false, defaultValue: [] },
      deliveryNote: { type: DataTypes.TEXT, allowNull: true },
      returnNote: { type: DataTypes.TEXT, allowNull: true },
      warrantyMonths: { type: DataTypes.INTEGER, allowNull: true },
      warrantyType: { type: DataTypes.STRING, allowNull: true },
      hsnCode: { type: DataTypes.STRING, allowNull: true },
      seoTitle: { type: DataTypes.STRING, allowNull: true },
      seoDescription: { type: DataTypes.TEXT, allowNull: true },
      videoUrl: { type: DataTypes.TEXT, allowNull: true },
      sizeChartUrl: { type: DataTypes.TEXT, allowNull: true },
      codEnabled: { type: DataTypes.BOOLEAN, allowNull: true },
      status: {
        type: DataTypes.ENUM(...(Object.values(PRODUCT_STATUS) as [string, ...string[]])),
        defaultValue: PRODUCT_STATUS.DRAFT,
      },
      approvedById: { type: DataTypes.UUID, allowNull: true },
      rejectionNote: { type: DataTypes.TEXT, allowNull: true },
      tags: { type: DataTypes.ARRAY(DataTypes.STRING), defaultValue: [] },
      avgRating: { type: DataTypes.DECIMAL(3, 2), defaultValue: 0 },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'products', timestamps: true, paranoid: true },
  );
  return Product;
};
