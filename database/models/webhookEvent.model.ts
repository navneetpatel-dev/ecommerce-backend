import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class WebhookEvent extends Model<InferAttributes<WebhookEvent>, InferCreationAttributes<WebhookEvent>> {
  declare id: CreationOptional<string>;
  declare provider: string;
  declare eventId: string;
  declare payload: CreationOptional<Record<string, unknown>>;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;
}

export const initWebhookEventModel = (sequelize: Sequelize) => {
  WebhookEvent.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      provider: { type: DataTypes.STRING, allowNull: false },
      eventId: { type: DataTypes.STRING, allowNull: false },
      payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'webhook_events',
      timestamps: true,
      paranoid: true,
      indexes: [{ unique: true, fields: ['provider', 'eventId'] }],
    },
  );
  return WebhookEvent;
};
