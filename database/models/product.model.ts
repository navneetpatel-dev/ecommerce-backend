import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional, NonAttribute } from 'sequelize';
import type { ProductVariant } from './productVariant.model';
import type { ProductImage } from './productImage.model';

export class Product extends Model<InferAttributes<Product>, InferCreationAttributes<Product>> {
  declare id: CreationOptional<string>;
  declare vendorId: string | null;
  declare categoryId: string;
  declare name: string;
  declare slug: string;
  declare description: string;
  declare basePrice: number;
  declare status: 'DRAFT' | 'PENDING_APPROVAL' | 'LIVE' | 'REJECTED' | 'ARCHIVED';
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
      status: {
        type: DataTypes.ENUM('DRAFT', 'PENDING_APPROVAL', 'LIVE', 'REJECTED', 'ARCHIVED'),
        defaultValue: 'DRAFT',
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
