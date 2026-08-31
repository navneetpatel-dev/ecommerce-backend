import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import {
  VENDOR_ENTITY_TYPE_VALUES,
  VENDOR_STATUS,
  VENDOR_STATUS_VALUES,
  type VendorEntityType,
  type VendorStatus,
} from '@core/constants/statuses';

export class Vendor extends Model<InferAttributes<Vendor>, InferCreationAttributes<Vendor>> {
  declare id: CreationOptional<string>;
  declare businessName: string;
  declare slug: string;
  declare gstNumber: string | null;
  declare state: string | null;
  /** Registered business address for tax / e-invoice SellerDtls. */
  declare addressLine1: CreationOptional<string | null>;
  declare city: CreationOptional<string | null>;
  declare pincode: CreationOptional<string | null>;
  declare entityType: VendorEntityType | null;
  declare bankDetails: Record<string, unknown>;
  declare logoUrl: string | null;
  declare bannerUrl: string | null;
  declare description: string | null;
  declare status: VendorStatus;
  declare rejectionReason: string | null;
  declare suspensionReason: string | null;
  declare commissionRate: CreationOptional<number>;
  declare performanceScore: CreationOptional<number>;
  /** Optional override for platform returnShippingFee (rupees). */
  declare returnShippingFee: CreationOptional<number | null>;
  declare codEnabled: CreationOptional<boolean>;
  /** Optional override for tax invoice number prefix (e.g. TW). */
  declare invoicePrefix: CreationOptional<string | null>;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    Vendor.hasMany(models.User, { foreignKey: 'vendorId', as: 'users' });
    Vendor.hasMany(models.Product, { foreignKey: 'vendorId' });
    Vendor.hasMany(models.VendorDocument, { foreignKey: 'vendorId' });
    Vendor.hasMany(models.VendorCategory, { foreignKey: 'vendorId', as: 'vendorCategories' });
    Vendor.belongsToMany(models.Category, {
      through: models.VendorCategory,
      foreignKey: 'vendorId',
      otherKey: 'categoryId',
      as: 'categories',
    });
  }
}

export const initVendorModel = (sequelize: Sequelize) => {
  Vendor.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      businessName: { type: DataTypes.STRING, allowNull: false },
      slug: { type: DataTypes.STRING, unique: true, allowNull: false },
      gstNumber: { type: DataTypes.STRING, allowNull: true },
      state: { type: DataTypes.STRING, allowNull: true },
      addressLine1: { type: DataTypes.STRING(255), allowNull: true },
      city: { type: DataTypes.STRING(100), allowNull: true },
      pincode: { type: DataTypes.STRING(12), allowNull: true },
      entityType: { type: DataTypes.ENUM(...VENDOR_ENTITY_TYPE_VALUES), allowNull: true },
      bankDetails: { type: DataTypes.JSONB, allowNull: false },
      logoUrl: { type: DataTypes.STRING, allowNull: true },
      bannerUrl: { type: DataTypes.STRING, allowNull: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      status: {
        type: DataTypes.ENUM(...VENDOR_STATUS_VALUES),
        defaultValue: VENDOR_STATUS.PENDING,
      },
      rejectionReason: { type: DataTypes.TEXT, allowNull: true },
      suspensionReason: { type: DataTypes.TEXT, allowNull: true },
      commissionRate: { type: DataTypes.DECIMAL(5, 2), defaultValue: 10.0 },
      performanceScore: { type: DataTypes.DECIMAL(5, 2), defaultValue: 0 },
      returnShippingFee: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      codEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      invoicePrefix: { type: DataTypes.STRING(16), allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'vendors', timestamps: true, paranoid: true },
  );
  return Vendor;
};
