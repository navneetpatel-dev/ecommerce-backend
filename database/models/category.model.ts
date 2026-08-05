import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class Category extends Model<InferAttributes<Category>, InferCreationAttributes<Category>> {
  declare id: CreationOptional<string>;
  declare name: string;
  declare slug: string;
  declare parentId: string | null;
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
  }
}

export const initCategoryModel = (sequelize: Sequelize) => {
  Category.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      name: { type: DataTypes.STRING, allowNull: false },
      slug: { type: DataTypes.STRING, unique: true, allowNull: false },
      parentId: { type: DataTypes.UUID, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'categories', timestamps: true, paranoid: true },
  );
  return Category;
};
