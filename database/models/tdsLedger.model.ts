import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class TdsLedger extends Model<InferAttributes<TdsLedger>, InferCreationAttributes<TdsLedger>> {
  declare id: CreationOptional<string>;
  declare orderId: string;
  declare subOrderId: string;
  declare vendorId: string;
  declare taxableAmountPaise: number;
  declare ratePercent: number;
  declare tdsAmountPaise: number;
  declare payoutId: CreationOptional<string | null>;
  /** Income-tax section — default 194O. */
  declare section: CreationOptional<string>;
  /** YYYY-MM period for TDS returns. */
  declare period: CreationOptional<string | null>;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    TdsLedger.belongsTo(models.Order, { foreignKey: 'orderId' });
    TdsLedger.belongsTo(models.SubOrder, { foreignKey: 'subOrderId' });
    TdsLedger.belongsTo(models.Vendor, { foreignKey: 'vendorId' });
    TdsLedger.belongsTo(models.Payout, { foreignKey: 'payoutId' });
  }
}

export const initTdsLedgerModel = (sequelize: Sequelize) => {
  TdsLedger.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      orderId: { type: DataTypes.UUID, allowNull: false },
      subOrderId: { type: DataTypes.UUID, allowNull: false },
      vendorId: { type: DataTypes.UUID, allowNull: false },
      taxableAmountPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      ratePercent: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
      tdsAmountPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      payoutId: { type: DataTypes.UUID, allowNull: true },
      section: { type: DataTypes.STRING(16), allowNull: false, defaultValue: '194O' },
      period: { type: DataTypes.STRING(7), allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'tds_ledgers', timestamps: true, paranoid: true },
  );
  return TdsLedger;
};
