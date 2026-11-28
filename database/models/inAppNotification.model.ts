import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import type { ModelRegistry } from './index';

export class InAppNotification extends Model<
  InferAttributes<InAppNotification>,
  InferCreationAttributes<InAppNotification>
> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare broadcastId: CreationOptional<string | null>;
  declare title: string;
  declare message: string;
  declare ctaLabel: CreationOptional<string | null>;
  declare ctaUrl: CreationOptional<string | null>;
  declare category: CreationOptional<string>;
  declare isRead: CreationOptional<boolean>;
  declare readAt: CreationOptional<Date | null>;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;

  static associate(models: ModelRegistry) {
    InAppNotification.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    InAppNotification.belongsTo(models.AdminBroadcast, {
      foreignKey: 'broadcastId',
      as: 'broadcast',
    });
  }
}

export const initInAppNotificationModel = (sequelize: Sequelize) => {
  InAppNotification.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: false },
      broadcastId: { type: DataTypes.UUID, allowNull: true },
      title: { type: DataTypes.STRING(200), allowNull: false },
      message: { type: DataTypes.TEXT, allowNull: false },
      ctaLabel: { type: DataTypes.STRING(80), allowNull: true },
      ctaUrl: { type: DataTypes.STRING(500), allowNull: true },
      category: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'BROADCAST' },
      isRead: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      readAt: { type: DataTypes.DATE, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'in_app_notifications',
      timestamps: true,
    },
  );
  return InAppNotification;
};
