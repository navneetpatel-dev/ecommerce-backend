import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class SubOrder extends Model<InferAttributes<SubOrder>, InferCreationAttributes<SubOrder>> {
  declare id: CreationOptional<string>;
  declare orderId: string;
  declare vendorId: string | null;
  declare status: 'PENDING' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'RETURNED';
  declare subtotal: number;
  declare shippingCost: CreationOptional<number>;
  declare shippingDiscountAmount: CreationOptional<number>;
  /** Net shipping charged to the customer. */
  declare shippingCharged: CreationOptional<number>;
  /** Customer total for this vendor slice. */
  declare customerTotal: CreationOptional<number>;
  declare taxAmount: CreationOptional<number>;
  declare taxableAmount: CreationOptional<number>;
  declare taxBreakdown: CreationOptional<Record<string, unknown> | null>;
  declare discountAmount: CreationOptional<number>;
  declare commissionAmount: CreationOptional<number>;
  declare tcsAmount: CreationOptional<number>;
  declare netPayoutAmount: CreationOptional<number>;
  /** Frozen paise snapshots: the stored money value. NULL = written before the snapshot existed. */
  declare subtotalPaise: CreationOptional<number | null>;
  declare shippingCostPaise: CreationOptional<number | null>;
  declare shippingDiscountAmountPaise: CreationOptional<number | null>;
  declare taxAmountPaise: CreationOptional<number | null>;
  declare taxableAmountPaise: CreationOptional<number | null>;
  declare discountAmountPaise: CreationOptional<number | null>;
  declare commissionAmountPaise: CreationOptional<number | null>;
  declare tcsAmountPaise: CreationOptional<number | null>;
  declare netPayoutAmountPaise: CreationOptional<number | null>;
  declare roundingAdjustmentPaise: CreationOptional<number>;
  /** Vendor-scoped GST tax invoice number allocated at order placement. */
  declare taxInvoiceNumber: CreationOptional<string | null>;
  declare taxInvoiceIssuedAt: CreationOptional<Date | null>;
  declare trackingId: string | null;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    SubOrder.belongsTo(models.Order, { as: 'order', foreignKey: 'orderId' });
    SubOrder.belongsTo(models.Vendor, { as: 'vendor', foreignKey: 'vendorId' });
    SubOrder.hasMany(models.OrderItem, { foreignKey: 'subOrderId', as: 'items' });
    SubOrder.hasOne(models.Shipment, { foreignKey: 'subOrderId', as: 'shipment' });
    SubOrder.hasMany(models.ReturnRequest, { foreignKey: 'subOrderId', as: 'returnRequests' });
    SubOrder.hasOne(models.CommissionLedger, { foreignKey: 'subOrderId' });
  }
}

export const initSubOrderModel = (sequelize: Sequelize) => {
  SubOrder.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      orderId: { type: DataTypes.UUID, allowNull: false },
      vendorId: { type: DataTypes.UUID, allowNull: true },
      status: {
        type: DataTypes.ENUM('PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED'),
        defaultValue: 'PENDING',
      },
      subtotal: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      shippingCost: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      shippingDiscountAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      shippingCharged: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      customerTotal: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      taxAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      taxableAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      taxBreakdown: { type: DataTypes.JSONB, allowNull: true },
      discountAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      commissionAmount: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
      tcsAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      netPayoutAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      subtotalPaise: { type: DataTypes.BIGINT, allowNull: true },
      shippingCostPaise: { type: DataTypes.BIGINT, allowNull: true },
      shippingDiscountAmountPaise: { type: DataTypes.BIGINT, allowNull: true },
      taxAmountPaise: { type: DataTypes.BIGINT, allowNull: true },
      taxableAmountPaise: { type: DataTypes.BIGINT, allowNull: true },
      discountAmountPaise: { type: DataTypes.BIGINT, allowNull: true },
      commissionAmountPaise: { type: DataTypes.BIGINT, allowNull: true },
      tcsAmountPaise: { type: DataTypes.BIGINT, allowNull: true },
      netPayoutAmountPaise: { type: DataTypes.BIGINT, allowNull: true },
      roundingAdjustmentPaise: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      taxInvoiceNumber: { type: DataTypes.STRING(64), allowNull: true, unique: true },
      taxInvoiceIssuedAt: { type: DataTypes.DATE, allowNull: true },
      trackingId: { type: DataTypes.STRING, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'sub_orders', timestamps: true, paranoid: true },
  );
  return SubOrder;
};
