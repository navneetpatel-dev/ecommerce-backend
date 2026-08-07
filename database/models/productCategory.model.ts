import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class ProductCategory extends Model<
  InferAttributes<ProductCategory>,
  InferCreationAttributes<ProductCategory>
> {
  declare id: CreationOptional<string>;
  declare productId: string;
  declare categoryId: string;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    ProductCategory.belongsTo(models.Product, { as: 'product', foreignKey: 'productId' });
    ProductCategory.belongsTo(models.Category, { as: 'category', foreignKey: 'categoryId' });
  }
}

export const initProductCategoryModel = (sequelize: Sequelize) => {
  ProductCategory.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      productId: { type: DataTypes.UUID, allowNull: false },
      categoryId: { type: DataTypes.UUID, allowNull: false },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'product_categories', timestamps: true, paranoid: true },
  );
  return ProductCategory;
};
