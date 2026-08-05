import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class CommissionLedger extends Model<InferAttributes<CommissionLedger>, InferCreationAttributes<CommissionLedger>> {
  declare id: CreationOptional<string>;
  declare vendorId: string;
  declare subOrderId: string;
  declare saleAmount: number;
  declare commissionRate: number;
  declare commissionAmount: number;
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
