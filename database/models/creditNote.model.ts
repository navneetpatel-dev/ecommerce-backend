import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class CreditNote extends Model<InferAttributes<CreditNote>, InferCreationAttributes<CreditNote>> {
  declare id: CreationOptional<string>;
  declare number: string;
  /** The return this refunds; null for an RTO credit note (no customer return). */
  declare returnRequestId: CreationOptional<string | null>;
  declare orderId: string;
  /** The invoice line credited; null for a platform-fee line (gift wrap). */
  declare orderItemId: CreationOptional<string | null>;
  declare subOrderId: CreationOptional<string | null>;
  declare vendorId: CreationOptional<string | null>;
  /** Original vendor tax invoice this credit note adjusts. */
  declare againstInvoiceNumber: CreationOptional<string | null>;
  declare userId: string;
  declare merchandisePaise: number;
  declare taxPaise: number;
  declare totalPaise: number;
  declare taxBreakdown: CreationOptional<Record<string, unknown> | null>;
  declare reason: CreationOptional<string | null>;
  declare issuedAt: CreationOptional<Date | null>;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    CreditNote.belongsTo(models.ReturnRequest, { foreignKey: 'returnRequestId', as: 'ReturnRequest' });
    CreditNote.belongsTo(models.Order, { foreignKey: 'orderId' });
    CreditNote.belongsTo(models.OrderItem, { foreignKey: 'orderItemId' });
    CreditNote.belongsTo(models.SubOrder, { foreignKey: 'subOrderId' });
    CreditNote.belongsTo(models.Vendor, { foreignKey: 'vendorId', as: 'Vendor' });
    CreditNote.belongsTo(models.User, { foreignKey: 'userId', as: 'User' });
  }
}

export const initCreditNoteModel = (sequelize: Sequelize) => {
  CreditNote.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      number: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      returnRequestId: { type: DataTypes.UUID, allowNull: true },
      orderId: { type: DataTypes.UUID, allowNull: false },
      orderItemId: { type: DataTypes.UUID, allowNull: true },
      subOrderId: { type: DataTypes.UUID, allowNull: true },
      vendorId: { type: DataTypes.UUID, allowNull: true },
      againstInvoiceNumber: { type: DataTypes.STRING(64), allowNull: true },
      userId: { type: DataTypes.UUID, allowNull: false },
      merchandisePaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      taxPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      totalPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      taxBreakdown: { type: DataTypes.JSONB, allowNull: true },
      reason: { type: DataTypes.TEXT, allowNull: true },
      issuedAt: { type: DataTypes.DATE, allowNull: true },
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
