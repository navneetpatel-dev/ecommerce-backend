import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { paiseBackedRupees } from '@modules/pricing/paiseBackedRupees';

export class CommissionLedger extends Model<InferAttributes<CommissionLedger>, InferCreationAttributes<CommissionLedger>> {
  declare id: CreationOptional<string>;
  declare vendorId: string;
  declare subOrderId: string;
  declare saleAmount: CreationOptional<number>;
  declare commissionRate: number;
  declare commissionAmount: CreationOptional<number>;
  declare taxableAmount: CreationOptional<number>;
  declare discountAmount: CreationOptional<number>;
  declare discountBearer: CreationOptional<'PLATFORM' | 'VENDOR' | null>;
  declare taxAmount: CreationOptional<number>;
  declare tcsAmount: CreationOptional<number>;
  declare netPayoutAmount: CreationOptional<number>;
  declare shippingCollected: CreationOptional<number>;
  /** Frozen paise snapshots: the only stored money value. The rupee names above read from these. */
  declare saleAmountPaise: number;
  declare commissionAmountPaise: number;
  declare taxableAmountPaise: CreationOptional<number>;
  declare discountAmountPaise: CreationOptional<number>;
  declare taxAmountPaise: CreationOptional<number>;
  declare tcsAmountPaise: CreationOptional<number>;
  declare netPayoutAmountPaise: CreationOptional<number>;
  declare shippingCollectedPaise: CreationOptional<number>;
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
      saleAmount: paiseBackedRupees('saleAmountPaise'),
      commissionRate: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
      commissionAmount: paiseBackedRupees('commissionAmountPaise'),
      taxableAmount: paiseBackedRupees('taxableAmountPaise'),
      discountAmount: paiseBackedRupees('discountAmountPaise'),
      discountBearer: {
        type: DataTypes.ENUM('PLATFORM', 'VENDOR'),
        allowNull: true,
      },
      taxAmount: paiseBackedRupees('taxAmountPaise'),
      tcsAmount: paiseBackedRupees('tcsAmountPaise'),
      netPayoutAmount: paiseBackedRupees('netPayoutAmountPaise'),
      shippingCollected: paiseBackedRupees('shippingCollectedPaise'),
      saleAmountPaise: { type: DataTypes.BIGINT, allowNull: false },
      commissionAmountPaise: { type: DataTypes.BIGINT, allowNull: false },
      taxableAmountPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      discountAmountPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      taxAmountPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      tcsAmountPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      netPayoutAmountPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      shippingCollectedPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
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
