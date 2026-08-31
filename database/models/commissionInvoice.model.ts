import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';

export class CommissionInvoice extends Model<
  InferAttributes<CommissionInvoice>,
  InferCreationAttributes<CommissionInvoice>
> {
  declare id: CreationOptional<string>;
  declare number: string;
  declare vendorId: string;
  declare payoutId: CreationOptional<string | null>;
  declare periodStart: Date;
  declare periodEnd: Date;
  declare taxablePaise: number;
  declare gstPaise: number;
  declare cgstPaise: number;
  declare sgstPaise: number;
  declare igstPaise: number;
  declare totalPaise: number;
  declare gstRatePercent: number;
  declare sacCode: string;
  declare placeOfSupplyState: CreationOptional<string | null>;
  declare issuedAt: Date;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    CommissionInvoice.belongsTo(models.Vendor, { foreignKey: 'vendorId', as: 'vendor' });
    CommissionInvoice.belongsTo(models.Payout, { foreignKey: 'payoutId', as: 'payout' });
  }
}

export const initCommissionInvoiceModel = (sequelize: Sequelize) => {
  CommissionInvoice.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      number: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      vendorId: { type: DataTypes.UUID, allowNull: false },
      payoutId: { type: DataTypes.UUID, allowNull: true },
      periodStart: { type: DataTypes.DATE, allowNull: false },
      periodEnd: { type: DataTypes.DATE, allowNull: false },
      taxablePaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      gstPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      cgstPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      sgstPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      igstPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      totalPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      gstRatePercent: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 18 },
      sacCode: { type: DataTypes.STRING(16), allowNull: false, defaultValue: '9985' },
      placeOfSupplyState: { type: DataTypes.STRING(64), allowNull: true },
      issuedAt: { type: DataTypes.DATE, allowNull: false },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'commission_invoices', timestamps: true, paranoid: true },
  );
  return CommissionInvoice;
};
