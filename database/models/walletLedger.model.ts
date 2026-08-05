import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class WalletLedger extends Model<InferAttributes<WalletLedger>, InferCreationAttributes<WalletLedger>> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare type: 'CREDIT' | 'DEBIT';
  declare amount: number;
  declare balanceAfter: number;
  declare referenceType: string;
  declare referenceId: string;
  declare description: string;
  declare expiresAt: Date | null;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    WalletLedger.belongsTo(models.User, { foreignKey: 'userId' });
  }
}

export const initWalletLedgerModel = (sequelize: Sequelize) => {
  WalletLedger.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: false },
      type: { type: DataTypes.ENUM('CREDIT', 'DEBIT'), allowNull: false },
      amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      balanceAfter: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      referenceType: { type: DataTypes.STRING, allowNull: false },
      referenceId: { type: DataTypes.UUID, allowNull: false },
      description: { type: DataTypes.STRING, allowNull: false },
      expiresAt: { type: DataTypes.DATE, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'wallet_ledgers', timestamps: true, paranoid: true },
  );
  return WalletLedger;
};
