import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class WalletWriteOff extends Model<
  InferAttributes<WalletWriteOff>,
  InferCreationAttributes<WalletWriteOff>
> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare originalClawbackAmount: number;
  declare recoveredAmount: number;
  declare writtenOffAmount: number;
  declare referenceType: string;
  declare referenceId: string;
  declare bornBy: 'PLATFORM' | 'VENDOR';
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    WalletWriteOff.belongsTo(models.User, { foreignKey: 'userId' });
  }
}

export const initWalletWriteOffModel = (sequelize: Sequelize) => {
  WalletWriteOff.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: false },
      originalClawbackAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      recoveredAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      writtenOffAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      referenceType: { type: DataTypes.STRING(64), allowNull: false },
      referenceId: { type: DataTypes.STRING(64), allowNull: false },
      bornBy: { type: DataTypes.ENUM('PLATFORM', 'VENDOR'), allowNull: false },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'wallet_write_offs', timestamps: true, paranoid: true },
  );
  return WalletWriteOff;
};
