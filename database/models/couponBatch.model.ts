import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class CouponBatch extends Model<InferAttributes<CouponBatch>, InferCreationAttributes<CouponBatch>> {
  declare id: CreationOptional<string>;
  declare name: string;
  declare templateCouponConfig: CreationOptional<Record<string, unknown>>;
  declare generatedCount: CreationOptional<number>;
  declare createdById: string;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    CouponBatch.belongsTo(models.User, { as: 'creator', foreignKey: 'createdById' });
    CouponBatch.hasMany(models.Coupon, { foreignKey: 'batchId', as: 'coupons' });
  }
}

export const initCouponBatchModel = (sequelize: Sequelize) => {
  CouponBatch.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      name: { type: DataTypes.STRING, allowNull: false },
      templateCouponConfig: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      generatedCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      createdById: { type: DataTypes.UUID, allowNull: false },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'coupon_batches', timestamps: true, paranoid: true },
  );
  return CouponBatch;
};
