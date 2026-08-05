import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class ProductVariant extends Model<InferAttributes<ProductVariant>, InferCreationAttributes<ProductVariant>> {
  declare id: CreationOptional<string>;
  declare productId: string;
  declare sku: string;
  declare attributes: CreationOptional<Record<string, string>>;
  declare price: number;
  declare stock: CreationOptional<number>;
  declare lowStockAt: CreationOptional<number>;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
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
