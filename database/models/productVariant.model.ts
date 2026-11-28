import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import type { ModelRegistry } from './index';

export class ProductVariant extends Model<InferAttributes<ProductVariant>, InferCreationAttributes<ProductVariant>> {
  declare id: CreationOptional<string>;
  declare productId: string;
  declare sku: string;
  declare attributes: CreationOptional<Record<string, string>>;
  declare price: number;
  declare stock: CreationOptional<number>;
  /** Its price with GST is above the product's MRP: not on sale until corrected. */
  declare aboveMrp: CreationOptional<boolean>;
  declare weightGrams: CreationOptional<number>;
  declare lowStockAt: CreationOptional<number>;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: ModelRegistry) {
    ProductVariant.belongsTo(models.Product, { as: 'product', foreignKey: 'productId' });
  }
}

export const initProductVariantModel = (sequelize: Sequelize) => {
  ProductVariant.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      productId: { type: DataTypes.UUID, allowNull: false },
      sku: { type: DataTypes.STRING, unique: true, allowNull: false },
      attributes: { type: DataTypes.JSONB, defaultValue: {} },
      price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      stock: { type: DataTypes.INTEGER, defaultValue: 0 },
      aboveMrp: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      weightGrams: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 500 },
      lowStockAt: { type: DataTypes.INTEGER, defaultValue: 5 },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'product_variants', timestamps: true, paranoid: true },
  );
  return ProductVariant;
};
