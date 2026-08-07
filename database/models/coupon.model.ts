import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export type CouponType = 'PERCENTAGE' | 'FLAT' | 'FREE_SHIPPING' | 'BOGO' | 'TIERED' | 'CASHBACK' | 'BUNDLE';

export interface CouponScope {
  type: 'category' | 'product' | 'vendor' | 'all';
  ids: string[];
}

export interface CouponUserRestriction {
  type: 'all' | 'specific' | 'segment' | 'firstOrder';
  value?: string | string[];
}

export class Coupon extends Model<InferAttributes<Coupon>, InferCreationAttributes<Coupon>> {
  declare id: CreationOptional<string>;
  declare code: string;
  declare type: CouponType;
  declare value: number | null;
  declare maxDiscountCap: number | null;
  declare minOrderValue: number | null;
  declare minQuantity: number | null;
  declare applicableScope: CreationOptional<CouponScope>;
  declare excludedItems: CreationOptional<{ productIds: string[]; categoryIds: string[] }>;
  declare userRestriction: CreationOptional<CouponUserRestriction>;
  declare usageLimitTotal: number | null;
  declare usageLimitPerUser: CreationOptional<number>;
  declare usedCount: CreationOptional<number>;
  declare startDate: Date;
  declare endDate: Date;
  declare stackable: CreationOptional<boolean>;
  declare priority: CreationOptional<number>;
  declare status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'ARCHIVED';
  declare discountBearer: CreationOptional<'PLATFORM' | 'VENDOR'>;
  declare batchId: string | null;
  declare createdById: string;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare vendorId: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    Coupon.belongsTo(models.User, { as: 'createdBy', foreignKey: 'createdById' });
    Coupon.belongsTo(models.Vendor, { foreignKey: 'vendorId' });
    Coupon.belongsTo(models.CouponBatch, { foreignKey: 'batchId', as: 'batch' });
    Coupon.hasMany(models.CouponUsage, { foreignKey: 'couponId' });
  }
}

export const initCouponModel = (sequelize: Sequelize) => {
  Coupon.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      code: { type: DataTypes.STRING, unique: true, allowNull: false },
      type: {
        type: DataTypes.ENUM('PERCENTAGE', 'FLAT', 'FREE_SHIPPING', 'BOGO', 'TIERED', 'CASHBACK', 'BUNDLE'),
        allowNull: false,
      },
      value: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      maxDiscountCap: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      minOrderValue: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      minQuantity: { type: DataTypes.INTEGER, allowNull: true },
      applicableScope: { type: DataTypes.JSONB, defaultValue: {} },
      excludedItems: { type: DataTypes.JSONB, defaultValue: {} },
      userRestriction: { type: DataTypes.JSONB, defaultValue: {} },
      usageLimitTotal: { type: DataTypes.INTEGER, allowNull: true },
      usageLimitPerUser: { type: DataTypes.INTEGER, defaultValue: 1 },
      usedCount: { type: DataTypes.INTEGER, defaultValue: 0 },
      startDate: { type: DataTypes.DATE, allowNull: false },
      endDate: { type: DataTypes.DATE, allowNull: false },
      stackable: { type: DataTypes.BOOLEAN, defaultValue: false },
      priority: { type: DataTypes.INTEGER, defaultValue: 0 },
      status: { type: DataTypes.ENUM('DRAFT', 'ACTIVE', 'PAUSED', 'EXPIRED', 'ARCHIVED'), defaultValue: 'DRAFT' },
      discountBearer: {
        type: DataTypes.ENUM('PLATFORM', 'VENDOR'),
        allowNull: false,
        defaultValue: 'PLATFORM',
      },
      batchId: { type: DataTypes.UUID, allowNull: true },
      createdById: { type: DataTypes.UUID, allowNull: false },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      vendorId: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'coupons', timestamps: true, paranoid: true },
  );
  return Coupon;
};
