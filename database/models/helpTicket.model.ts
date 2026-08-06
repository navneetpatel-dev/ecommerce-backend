import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class HelpTicket extends Model<InferAttributes<HelpTicket>, InferCreationAttributes<HelpTicket>> {
  declare id: CreationOptional<string>;
  declare userId: string | null;
  declare name: string;
  declare email: string;
  declare topic: 'ORDERS' | 'SHIPPING' | 'RETURNS' | 'PAYMENTS' | 'ACCOUNT' | 'PRODUCTS' | 'SELLERS' | 'OTHER';
  declare subject: string;
  declare message: string;
  declare orderId: string | null;
  declare status: CreationOptional<'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'>;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    HelpTicket.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  }
}

export const initHelpTicketModel = (sequelize: Sequelize) => {
  HelpTicket.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: true },
      name: { type: DataTypes.STRING(120), allowNull: false },
      email: { type: DataTypes.STRING(255), allowNull: false },
      topic: {
        type: DataTypes.ENUM(
          'ORDERS',
          'SHIPPING',
          'RETURNS',
          'PAYMENTS',
          'ACCOUNT',
          'PRODUCTS',
          'SELLERS',
          'OTHER',
        ),
        allowNull: false,
        defaultValue: 'OTHER',
      },
      subject: { type: DataTypes.STRING(200), allowNull: false },
      message: { type: DataTypes.TEXT, allowNull: false },
      orderId: { type: DataTypes.UUID, allowNull: true },
      status: {
        type: DataTypes.ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'),
        allowNull: false,
        defaultValue: 'OPEN',
      },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'help_tickets', timestamps: true, paranoid: true },
  );
  return HelpTicket;
};
