import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class CouponUsage extends Model<InferAttributes<CouponUsage>, InferCreationAttributes<CouponUsage>> {
  declare id: CreationOptional<string>;
  declare couponId: string;
  declare userId: string;
  declare orderId: string;
  declare discountApplied: number;
  declare usedAt: CreationOptional<Date>;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    CouponUsage.belongsTo(models.Coupon, { foreignKey: 'couponId' });
    CouponUsage.belongsTo(models.User, { foreignKey: 'userId' });
    CouponUsage.belongsTo(models.Order, { foreignKey: 'orderId' });
  }
}

export const initCouponUsageModel = (sequelize: Sequelize) => {
  CouponUsage.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      couponId: { type: DataTypes.UUID, allowNull: false },
      userId: { type: DataTypes.UUID, allowNull: false },
      orderId: { type: DataTypes.UUID, allowNull: false },
      discountApplied: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      usedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'coupon_usages',
      timestamps: true,
      paranoid: true,
      indexes: [{ unique: true, fields: ['couponId', 'orderId'] }],
    },
  );
  return CouponUsage;
};
