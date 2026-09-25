import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class CommissionLedger extends Model<InferAttributes<CommissionLedger>, InferCreationAttributes<CommissionLedger>> {
  declare id: CreationOptional<string>;
  declare vendorId: string;
  declare subOrderId: string;
  declare saleAmount: number;
  declare commissionRate: number;
  declare commissionAmount: number;
  declare taxableAmount: CreationOptional<number>;
  declare discountAmount: CreationOptional<number>;
  declare discountBearer: CreationOptional<'PLATFORM' | 'VENDOR' | null>;
  declare taxAmount: CreationOptional<number>;
  declare tcsAmount: CreationOptional<number>;
  declare netPayoutAmount: CreationOptional<number>;
  declare shippingCollected: CreationOptional<number>;
  declare saleAmountPaise: CreationOptional<number | null>;
  declare commissionAmountPaise: CreationOptional<number | null>;
  declare taxableAmountPaise: CreationOptional<number | null>;
  declare discountAmountPaise: CreationOptional<number | null>;
  declare taxAmountPaise: CreationOptional<number | null>;
  declare tcsAmountPaise: CreationOptional<number | null>;
  declare netPayoutAmountPaise: CreationOptional<number | null>;
  declare shippingCollectedPaise: CreationOptional<number | null>;
  /** Optional adjustment marker (e.g. CashbackCost / CashbackCostReversal). */
  declare referenceType: CreationOptional<string | null>;
  declare status: 'PENDING' | 'SETTLED' | 'CLAWED_BACK';
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    CommissionLedger.belongsTo(models.Vendor, { foreignKey: 'vendorId' });
    CommissionLedger.belongsTo(models.SubOrder, { foreignKey: 'subOrderId' });
  }
}

export const initCommissionLedgerModel = (sequelize: Sequelize) => {
  CommissionLedger.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      vendorId: { type: DataTypes.UUID, allowNull: false },
      subOrderId: { type: DataTypes.UUID, allowNull: false },
      saleAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      commissionRate: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
      commissionAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      taxableAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      discountAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      discountBearer: {
        type: DataTypes.ENUM('PLATFORM', 'VENDOR'),
        allowNull: true,
      },
      taxAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      tcsAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      netPayoutAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      shippingCollected: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      saleAmountPaise: { type: DataTypes.BIGINT, allowNull: true },
      commissionAmountPaise: { type: DataTypes.BIGINT, allowNull: true },
      taxableAmountPaise: { type: DataTypes.BIGINT, allowNull: true },
      discountAmountPaise: { type: DataTypes.BIGINT, allowNull: true },
      taxAmountPaise: { type: DataTypes.BIGINT, allowNull: true },
      tcsAmountPaise: { type: DataTypes.BIGINT, allowNull: true },
      netPayoutAmountPaise: { type: DataTypes.BIGINT, allowNull: true },
      shippingCollectedPaise: { type: DataTypes.BIGINT, allowNull: true },
      referenceType: { type: DataTypes.STRING(64), allowNull: true },
      status: { type: DataTypes.ENUM('PENDING', 'SETTLED', 'CLAWED_BACK'), defaultValue: 'PENDING' },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'commission_ledgers', timestamps: true, paranoid: true },
  );
  return CommissionLedger;
};
