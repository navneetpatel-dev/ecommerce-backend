import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class PlatformSetting extends Model<InferAttributes<PlatformSetting>, InferCreationAttributes<PlatformSetting>> {
  declare id: CreationOptional<string>;
  declare key: string;
  declare value: Record<string, unknown>;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;
}

export const initPlatformSettingModel = (sequelize: Sequelize) => {
  PlatformSetting.init({
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    key: { type: DataTypes.STRING, unique: true, allowNull: false },
    value: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    createdBy: { type: DataTypes.UUID, allowNull: true },
    updatedBy: { type: DataTypes.UUID, allowNull: true },
    deletedBy: { type: DataTypes.UUID, allowNull: true },
    createdAt: DataTypes.DATE, updatedAt: DataTypes.DATE, deletedAt: DataTypes.DATE,
  }, { sequelize, tableName: 'platform_settings', timestamps: true, paranoid: true });
  return PlatformSetting;
};
