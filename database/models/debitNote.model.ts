import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class DebitNote extends Model<InferAttributes<DebitNote>, InferCreationAttributes<DebitNote>> {
  declare id: CreationOptional<string>;
  declare number: string;
  declare returnRequestId: string;
  declare orderId: string;
  declare orderItemId: string;
  declare subOrderId: CreationOptional<string | null>;
  declare vendorId: string;
  /** Original vendor tax invoice this debit note relates to. */
  declare againstInvoiceNumber: CreationOptional<string | null>;
  declare commissionPaise: number;
  declare tcsPaise: number;
  declare netClawbackPaise: number;
  declare reason: CreationOptional<string | null>;
  declare issuedAt: CreationOptional<Date | null>;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    DebitNote.belongsTo(models.ReturnRequest, { foreignKey: 'returnRequestId' });
    DebitNote.belongsTo(models.Order, { foreignKey: 'orderId' });
    DebitNote.belongsTo(models.OrderItem, { foreignKey: 'orderItemId' });
    DebitNote.belongsTo(models.SubOrder, { foreignKey: 'subOrderId' });
    DebitNote.belongsTo(models.Vendor, { foreignKey: 'vendorId', as: 'Vendor' });
  }
}

export const initDebitNoteModel = (sequelize: Sequelize) => {
  DebitNote.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      number: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      returnRequestId: { type: DataTypes.UUID, allowNull: false },
      orderId: { type: DataTypes.UUID, allowNull: false },
      orderItemId: { type: DataTypes.UUID, allowNull: false },
      subOrderId: { type: DataTypes.UUID, allowNull: true },
      vendorId: { type: DataTypes.UUID, allowNull: false },
      againstInvoiceNumber: { type: DataTypes.STRING(64), allowNull: true },
      commissionPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      tcsPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      netClawbackPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      reason: { type: DataTypes.TEXT, allowNull: true },
      issuedAt: { type: DataTypes.DATE, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'debit_notes', timestamps: true, paranoid: true },
  );
  return DebitNote;
};
