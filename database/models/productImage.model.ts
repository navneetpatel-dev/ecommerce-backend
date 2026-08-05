import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class ProductImage extends Model<InferAttributes<ProductImage>, InferCreationAttributes<ProductImage>> {
  declare id: CreationOptional<string>;
  declare productId: string;
  declare url: string;
  declare isPrimary: CreationOptional<boolean>;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    ProductImage.belongsTo(models.Product, { foreignKey: 'productId' });
  }
}

export const initProductImageModel = (sequelize: Sequelize) => {
  ProductImage.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      productId: { type: DataTypes.UUID, allowNull: false },
      url: { type: DataTypes.STRING, allowNull: false },
      isPrimary: { type: DataTypes.BOOLEAN, defaultValue: false },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'product_images', timestamps: true, paranoid: true },
  );
  return ProductImage;
};
