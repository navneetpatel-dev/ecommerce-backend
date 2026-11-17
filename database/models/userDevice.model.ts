import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

/** A browser/device a user has signed in from; a sign-in from an unknown one triggers an alert email. */
export class UserDevice extends Model<InferAttributes<UserDevice>, InferCreationAttributes<UserDevice>> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare fingerprint: string;
  declare userAgent: string | null;
  declare ipAddress: string | null;
  declare lastSeenAt: Date;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
}

export const initUserDeviceModel = (sequelize: Sequelize) => {
  UserDevice.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: false },
      fingerprint: { type: DataTypes.STRING(64), allowNull: false },
      userAgent: { type: DataTypes.STRING(400), allowNull: true },
      ipAddress: { type: DataTypes.STRING(64), allowNull: true },
      lastSeenAt: { type: DataTypes.DATE, allowNull: false },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'user_devices', timestamps: true, paranoid: false },
  );
  return UserDevice;
};
