import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class CreditNote extends Model<InferAttributes<CreditNote>, InferCreationAttributes<CreditNote>> {
  declare id: CreationOptional<string>;
  declare number: string;
  declare returnRequestId: string;
  declare orderId: string;
  declare orderItemId: string;
  declare userId: string;
  declare merchandisePaise: number;
  declare taxPaise: number;
  declare totalPaise: number;
  declare taxBreakdown: CreationOptional<Record<string, unknown> | null>;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    CreditNote.belongsTo(models.ReturnRequest, { foreignKey: 'returnRequestId' });
    CreditNote.belongsTo(models.Order, { foreignKey: 'orderId' });
    CreditNote.belongsTo(models.OrderItem, { foreignKey: 'orderItemId' });
    CreditNote.belongsTo(models.User, { foreignKey: 'userId' });
  }
}

export const initCreditNoteModel = (sequelize: Sequelize) => {
  CreditNote.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      number: { type: DataTypes.STRING(32), allowNull: false, unique: true },
      returnRequestId: { type: DataTypes.UUID, allowNull: false },
      orderId: { type: DataTypes.UUID, allowNull: false },
      orderItemId: { type: DataTypes.UUID, allowNull: false },
      userId: { type: DataTypes.UUID, allowNull: false },
      merchandisePaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      taxPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      totalPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      taxBreakdown: { type: DataTypes.JSONB, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'credit_notes', timestamps: true, paranoid: true },
  );
  return CreditNote;
};
