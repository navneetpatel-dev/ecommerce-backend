import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  NonAttribute,
} from 'sequelize';
import {
  SUPPORT_TICKET_CATEGORY_VALUES,
  SUPPORT_TICKET_PRIORITY,
  SUPPORT_TICKET_PRIORITY_VALUES,
  SUPPORT_TICKET_STATUS,
  SUPPORT_TICKET_STATUS_VALUES,
  type SupportTicketCategory,
  type SupportTicketPriority,
  type SupportTicketStatus,
} from '@core/constants/statuses';

export class SupportTicket extends Model<
  InferAttributes<SupportTicket>,
  InferCreationAttributes<SupportTicket>
> {
  declare id: CreationOptional<string>;
  declare ticketNumber: string;
  declare customerId: string;
  declare subject: string;
  declare description: string;
  declare category: SupportTicketCategory;
  declare relatedOrderId: string | null;
  declare relatedVendorId: string | null;
  declare priority: CreationOptional<SupportTicketPriority>;
  declare status: CreationOptional<SupportTicketStatus>;
  declare assignedToId: string | null;
  declare firstResponseAt: Date | null;
  declare resolvedAt: Date | null;
  declare closedAt: Date | null;
  declare customerSatisfactionRating: number | null;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  declare customer?: NonAttribute<{ id: string; name: string }>;
  declare relatedVendor?: NonAttribute<{ id: string; businessName: string }>;
  declare assignedTo?: NonAttribute<{ id: string; name: string }>;
  declare messages?: NonAttribute<unknown[]>;
  declare attachments?: NonAttribute<unknown[]>;

  static associate(models: Record<string, any>) {
    SupportTicket.belongsTo(models.User, { foreignKey: 'customerId', as: 'customer' });
    SupportTicket.belongsTo(models.User, { foreignKey: 'assignedToId', as: 'assignedTo' });
    SupportTicket.belongsTo(models.Vendor, { foreignKey: 'relatedVendorId', as: 'relatedVendor' });
    SupportTicket.hasMany(models.TicketMessage, { foreignKey: 'ticketId', as: 'messages' });
    SupportTicket.hasMany(models.TicketAttachment, { foreignKey: 'ticketId', as: 'attachments' });
  }
}

export const initSupportTicketModel = (sequelize: Sequelize) => {
  SupportTicket.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      ticketNumber: { type: DataTypes.STRING(32), allowNull: false, unique: true },
      customerId: { type: DataTypes.UUID, allowNull: false },
      subject: { type: DataTypes.STRING(255), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: false },
      category: {
        type: DataTypes.ENUM(...SUPPORT_TICKET_CATEGORY_VALUES),
        allowNull: false,
      },
      relatedOrderId: { type: DataTypes.UUID, allowNull: true },
      relatedVendorId: { type: DataTypes.UUID, allowNull: true },
      priority: {
        type: DataTypes.ENUM(...SUPPORT_TICKET_PRIORITY_VALUES),
        allowNull: false,
        defaultValue: SUPPORT_TICKET_PRIORITY.MEDIUM,
      },
      status: {
        type: DataTypes.ENUM(...SUPPORT_TICKET_STATUS_VALUES),
        allowNull: false,
        defaultValue: SUPPORT_TICKET_STATUS.OPEN,
      },
      assignedToId: { type: DataTypes.UUID, allowNull: true },
      firstResponseAt: { type: DataTypes.DATE, allowNull: true },
      resolvedAt: { type: DataTypes.DATE, allowNull: true },
      closedAt: { type: DataTypes.DATE, allowNull: true },
      customerSatisfactionRating: { type: DataTypes.INTEGER, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'support_tickets', timestamps: true, paranoid: true },
  );
  return SupportTicket;
};
