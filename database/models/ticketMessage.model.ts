import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  NonAttribute,
} from 'sequelize';
import type { TicketSenderRole } from '@core/constants/statuses';

export class TicketMessage extends Model<
  InferAttributes<TicketMessage>,
  InferCreationAttributes<TicketMessage>
> {
  declare id: CreationOptional<string>;
  declare ticketId: string;
  declare senderId: string;
  declare senderRole: TicketSenderRole | string;
  declare body: string;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  declare sender?: NonAttribute<{ id: string; name: string }>;
  declare attachments?: NonAttribute<unknown[]>;

  static associate(models: Record<string, any>) {
    TicketMessage.belongsTo(models.SupportTicket, { foreignKey: 'ticketId', as: 'ticket' });
    TicketMessage.belongsTo(models.User, { foreignKey: 'senderId', as: 'sender' });
    TicketMessage.hasMany(models.TicketAttachment, { foreignKey: 'messageId', as: 'attachments' });
  }
}

export const initTicketMessageModel = (sequelize: Sequelize) => {
  TicketMessage.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      ticketId: { type: DataTypes.UUID, allowNull: false },
      senderId: { type: DataTypes.UUID, allowNull: false },
      senderRole: { type: DataTypes.STRING(64), allowNull: false },
      body: { type: DataTypes.TEXT, allowNull: false },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'ticket_messages', timestamps: true, paranoid: true },
  );
  return TicketMessage;
};
