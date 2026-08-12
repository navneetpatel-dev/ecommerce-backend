import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';

export class TicketRead extends Model<
  InferAttributes<TicketRead>,
  InferCreationAttributes<TicketRead>
> {
  declare id: CreationOptional<string>;
  declare ticketId: string;
  declare userId: string;
  declare lastReadAt: Date;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    TicketRead.belongsTo(models.SupportTicket, { foreignKey: 'ticketId', as: 'ticket' });
    TicketRead.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  }
}

export const initTicketReadModel = (sequelize: Sequelize) => {
  TicketRead.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      ticketId: { type: DataTypes.UUID, allowNull: false },
      userId: { type: DataTypes.UUID, allowNull: false },
      lastReadAt: { type: DataTypes.DATE, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    },
    {
      sequelize,
      tableName: 'ticket_reads',
      timestamps: true,
      paranoid: false,
      indexes: [{ unique: true, fields: ['ticketId', 'userId'], name: 'ticket_reads_ticket_user_uidx' }],
    },
  );
  return TicketRead;
};
