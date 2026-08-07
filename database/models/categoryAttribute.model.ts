import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import {
  CATEGORY_ATTRIBUTE_TYPE_VALUES,
  type CategoryAttributeType,
} from '@core/constants/statuses';

export class CategoryAttribute extends Model<
  InferAttributes<CategoryAttribute>,
  InferCreationAttributes<CategoryAttribute>
> {
  declare id: CreationOptional<string>;
  declare categoryId: string;
  declare name: string;
  declare type: CategoryAttributeType;
  declare options: CreationOptional<unknown[]>;
  declare displayOrder: CreationOptional<number>;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    CategoryAttribute.belongsTo(models.Category, { as: 'category', foreignKey: 'categoryId' });
  }
}

export const initCategoryAttributeModel = (sequelize: Sequelize) => {
  CategoryAttribute.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      categoryId: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      type: {
        type: DataTypes.ENUM(...CATEGORY_ATTRIBUTE_TYPE_VALUES),
        allowNull: false,
      },
      options: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      displayOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'category_attributes', timestamps: true, paranoid: true },
  );
  return CategoryAttribute;
};
