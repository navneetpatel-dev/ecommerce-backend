import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import {
  CATEGORY_STATUS,
  CATEGORY_STATUS_VALUES,
  type CategoryStatus,
} from '@core/constants/statuses';

export class Category extends Model<InferAttributes<Category>, InferCreationAttributes<Category>> {
  declare id: CreationOptional<string>;
  declare name: string;
  declare slug: string;
  declare imageUrl: string | null;
  declare parentId: string | null;
  declare status: CreationOptional<CategoryStatus>;
  declare displayOrder: CreationOptional<number>;
  declare seoTitle: string | null;
  declare seoDescription: string | null;
  declare commissionRate: number | null;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    Category.belongsTo(models.Category, { as: 'parent', foreignKey: 'parentId' });
    Category.hasMany(models.Category, { as: 'children', foreignKey: 'parentId' });
    Category.hasMany(models.Product, { foreignKey: 'categoryId' });
    Category.hasMany(models.CategoryAttribute, {
      as: 'attributes',
      foreignKey: 'categoryId',
    });
    Category.belongsToMany(models.Product, {
      through: models.ProductCategory,
      as: 'taggedProducts',
      foreignKey: 'categoryId',
      otherKey: 'productId',
    });
  }
}

export const initCategoryModel = (sequelize: Sequelize) => {
  Category.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      name: { type: DataTypes.STRING, allowNull: false },
      slug: { type: DataTypes.STRING, unique: true, allowNull: false },
      imageUrl: { type: DataTypes.STRING, allowNull: true },
      parentId: { type: DataTypes.UUID, allowNull: true },
      status: {
        type: DataTypes.ENUM(...CATEGORY_STATUS_VALUES),
        allowNull: false,
        defaultValue: CATEGORY_STATUS.ACTIVE,
      },
      displayOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      seoTitle: { type: DataTypes.STRING, allowNull: true },
      seoDescription: { type: DataTypes.TEXT, allowNull: true },
      commissionRate: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'categories', timestamps: true, paranoid: false },
  );
  return Category;
};
