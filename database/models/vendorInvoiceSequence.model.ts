import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';

export class VendorInvoiceSequence extends Model<
  InferAttributes<VendorInvoiceSequence>,
  InferCreationAttributes<VendorInvoiceSequence>
> {
  declare id: CreationOptional<string>;
  declare vendorId: string | null;
  declare financialYear: string;
  /** TAX_INVOICE | CREDIT_NOTE | DEBIT_NOTE | COMMISSION_INVOICE */
  declare kind: CreationOptional<string>;
  declare nextValue: number | string;
  declare prefix: string;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    VendorInvoiceSequence.belongsTo(models.Vendor, {
      foreignKey: 'vendorId',
      as: 'vendor',
    });
  }
}

export const initVendorInvoiceSequenceModel = (sequelize: Sequelize) => {
  VendorInvoiceSequence.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      vendorId: { type: DataTypes.UUID, allowNull: true },
      financialYear: { type: DataTypes.STRING(9), allowNull: false },
      kind: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'TAX_INVOICE',
      },
      nextValue: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 1 },
      prefix: { type: DataTypes.STRING(16), allowNull: false },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'vendor_invoice_sequences',
      timestamps: true,
      paranoid: false,
    },
  );
  return VendorInvoiceSequence;
};
