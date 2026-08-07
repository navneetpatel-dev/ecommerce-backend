import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class DebitNote extends Model<InferAttributes<DebitNote>, InferCreationAttributes<DebitNote>> {
  declare id: CreationOptional<string>;
  declare number: string;
  declare returnRequestId: string;
  declare orderId: string;
  declare orderItemId: string;
  declare vendorId: string;
  declare commissionPaise: number;
  declare tcsPaise: number;
  declare netClawbackPaise: number;
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
    DebitNote.belongsTo(models.Vendor, { foreignKey: 'vendorId' });
  }
}

export const initDebitNoteModel = (sequelize: Sequelize) => {
  DebitNote.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      number: { type: DataTypes.STRING(32), allowNull: false, unique: true },
      returnRequestId: { type: DataTypes.UUID, allowNull: false },
      orderId: { type: DataTypes.UUID, allowNull: false },
      orderItemId: { type: DataTypes.UUID, allowNull: false },
      vendorId: { type: DataTypes.UUID, allowNull: false },
      commissionPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      tcsPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      netClawbackPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
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
