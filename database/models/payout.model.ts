import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class Payout extends Model<InferAttributes<Payout>, InferCreationAttributes<Payout>> {
  declare id: CreationOptional<string>;
  declare vendorId: string;
  declare amount: number;
  declare periodStart: Date;
  declare periodEnd: Date;
  declare status: 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED';
  declare razorpayPayoutId: string | null;
  declare paidAt: Date | null;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    Payout.belongsTo(models.Vendor, { foreignKey: 'vendorId' });
  }
}

export const initPayoutModel = (sequelize: Sequelize) => {
  Payout.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      vendorId: { type: DataTypes.UUID, allowNull: false },
      amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      periodStart: { type: DataTypes.DATE, allowNull: false },
      periodEnd: { type: DataTypes.DATE, allowNull: false },
      status: { type: DataTypes.ENUM('PENDING', 'PROCESSING', 'PAID', 'FAILED'), defaultValue: 'PENDING' },
      razorpayPayoutId: { type: DataTypes.STRING, allowNull: true },
      paidAt: { type: DataTypes.DATE, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'payouts', timestamps: true, paranoid: true },
  );
  return Payout;
};
