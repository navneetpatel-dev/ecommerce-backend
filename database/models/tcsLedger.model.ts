import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class TcsLedger extends Model<InferAttributes<TcsLedger>, InferCreationAttributes<TcsLedger>> {
  declare id: CreationOptional<string>;
  declare orderId: string;
  declare subOrderId: string;
  declare vendorId: string;
  declare taxableAmountPaise: number;
  declare ratePercent: number;
  declare tcsAmountPaise: number;
  declare tcsCgstPaise: CreationOptional<number>;
  declare tcsSgstPaise: CreationOptional<number>;
  declare tcsIgstPaise: CreationOptional<number>;
  /** YYYY-MM period for GSTR-8 filing. */
  declare period: CreationOptional<string | null>;
  /** CGST Act section — marketplace TCS is s.52. */
  declare section: CreationOptional<string>;
  /** COLLECTION | RETURN_ADJUSTMENT */
  declare entryType: CreationOptional<string>;
  declare vendorGstin: CreationOptional<string | null>;
  declare placeOfSupplyState: CreationOptional<string | null>;
  declare returnRequestId: CreationOptional<string | null>;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    TcsLedger.belongsTo(models.Order, { foreignKey: 'orderId' });
    TcsLedger.belongsTo(models.SubOrder, { foreignKey: 'subOrderId' });
    TcsLedger.belongsTo(models.Vendor, { foreignKey: 'vendorId' });
    TcsLedger.belongsTo(models.ReturnRequest, { foreignKey: 'returnRequestId' });
  }
}

export const initTcsLedgerModel = (sequelize: Sequelize) => {
  TcsLedger.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      orderId: { type: DataTypes.UUID, allowNull: false },
      subOrderId: { type: DataTypes.UUID, allowNull: false },
      vendorId: { type: DataTypes.UUID, allowNull: false },
      taxableAmountPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      ratePercent: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
      tcsAmountPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      tcsCgstPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      tcsSgstPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      tcsIgstPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      period: { type: DataTypes.STRING(7), allowNull: true },
      section: { type: DataTypes.STRING(8), allowNull: false, defaultValue: '52' },
      entryType: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'COLLECTION',
      },
      vendorGstin: { type: DataTypes.STRING(20), allowNull: true },
      placeOfSupplyState: { type: DataTypes.STRING(64), allowNull: true },
      returnRequestId: { type: DataTypes.UUID, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'tcs_ledgers', timestamps: true, paranoid: true },
  );
  return TcsLedger;
};
