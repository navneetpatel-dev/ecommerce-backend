import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import {
  TICKET_ATTACHMENT_TYPE_VALUES,
  type TicketAttachmentType,
} from '@core/constants/statuses';

export class TicketAttachment extends Model<
  InferAttributes<TicketAttachment>,
  InferCreationAttributes<TicketAttachment>
> {
  declare id: CreationOptional<string>;
  declare ticketId: string;
  declare messageId: string | null;
  declare url: string;
  declare type: TicketAttachmentType;
  declare durationSeconds: number | null;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    TicketAttachment.belongsTo(models.SupportTicket, { foreignKey: 'ticketId', as: 'ticket' });
    TicketAttachment.belongsTo(models.TicketMessage, { foreignKey: 'messageId', as: 'message' });
  }
}

export const initTicketAttachmentModel = (sequelize: Sequelize) => {
  TicketAttachment.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      ticketId: { type: DataTypes.UUID, allowNull: false },
      messageId: { type: DataTypes.UUID, allowNull: true },
      url: { type: DataTypes.STRING(1024), allowNull: false },
      type: {
        type: DataTypes.ENUM(...TICKET_ATTACHMENT_TYPE_VALUES),
        allowNull: false,
      },
      durationSeconds: { type: DataTypes.INTEGER, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'ticket_attachments', timestamps: true, paranoid: true },
  );
  return TicketAttachment;
};
