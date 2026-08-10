import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class VendorCategory extends Model<
  InferAttributes<VendorCategory>,
  InferCreationAttributes<VendorCategory>
> {
  declare id: CreationOptional<string>;
  declare vendorId: string;
  declare categoryId: string;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    VendorCategory.belongsTo(models.Vendor, { foreignKey: 'vendorId', as: 'vendor' });
    VendorCategory.belongsTo(models.Category, { foreignKey: 'categoryId', as: 'category' });
  }
}

export const initVendorCategoryModel = (sequelize: Sequelize) => {
  VendorCategory.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      vendorId: { type: DataTypes.UUID, allowNull: false },
      categoryId: { type: DataTypes.UUID, allowNull: false },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'vendor_categories', timestamps: true, paranoid: true },
  );
  return VendorCategory;
};
