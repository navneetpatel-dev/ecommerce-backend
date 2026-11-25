import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';

export type BroadcastChannel = 'EMAIL' | 'PUSH' | 'IN_APP';
export type BroadcastClassification = 'operational' | 'marketing';
export type BroadcastPriority = 'standard' | 'high';
export type BroadcastStatus = 'SCHEDULED' | 'PROCESSING' | 'SENT' | 'CANCELLED' | 'FAILED';

export class AdminBroadcast extends Model<
  InferAttributes<AdminBroadcast>,
  InferCreationAttributes<AdminBroadcast>
> {
  declare id: CreationOptional<string>;
  declare actorId: string | null;
  declare subject: string;
  declare message: string;
  declare ctaLabel: CreationOptional<string | null>;
  declare ctaUrl: CreationOptional<string | null>;
  declare classification: CreationOptional<BroadcastClassification>;
  declare priority: CreationOptional<BroadcastPriority>;
  declare channels: CreationOptional<BroadcastChannel[]>;
  declare targetConfig: Record<string, unknown>;
  declare status: CreationOptional<BroadcastStatus>;
  declare scheduledAt: CreationOptional<Date | null>;
  declare sentAt: CreationOptional<Date | null>;
  declare targetedCount: CreationOptional<number>;
  declare queuedCount: CreationOptional<number>;
  declare error: CreationOptional<string | null>;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    AdminBroadcast.belongsTo(models.User, { foreignKey: 'actorId', as: 'actor' });
  }
}

export const initAdminBroadcastModel = (sequelize: Sequelize) => {
  AdminBroadcast.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      actorId: { type: DataTypes.UUID, allowNull: true },
      subject: { type: DataTypes.STRING(200), allowNull: false },
      message: { type: DataTypes.TEXT, allowNull: false },
      ctaLabel: { type: DataTypes.STRING(80), allowNull: true },
      ctaUrl: { type: DataTypes.STRING(500), allowNull: true },
      classification: {
        type: DataTypes.ENUM('operational', 'marketing'),
        allowNull: false,
        defaultValue: 'operational',
      },
      priority: {
        type: DataTypes.ENUM('standard', 'high'),
        allowNull: false,
        defaultValue: 'standard',
      },
      channels: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: ['EMAIL'],
      },
      targetConfig: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      status: {
        type: DataTypes.ENUM('SCHEDULED', 'PROCESSING', 'SENT', 'CANCELLED', 'FAILED'),
        allowNull: false,
        defaultValue: 'PROCESSING',
      },
      scheduledAt: { type: DataTypes.DATE, allowNull: true },
      sentAt: { type: DataTypes.DATE, allowNull: true },
      targetedCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      queuedCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      error: { type: DataTypes.TEXT, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'admin_broadcasts',
      timestamps: true,
    },
  );
  return AdminBroadcast;
};
