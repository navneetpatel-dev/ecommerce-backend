import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { paiseBackedRupees } from '@modules/pricing/paiseBackedRupees';
import type { TaxInvoiceSnapshot } from '@modules/pricing/taxInvoiceSnapshot';

export class SubOrder extends Model<InferAttributes<SubOrder>, InferCreationAttributes<SubOrder>> {
  declare id: CreationOptional<string>;
  declare orderId: string;
  declare vendorId: string | null;
  declare status: 'PENDING' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'RETURNED';
  declare subtotal: CreationOptional<number>;
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
  /** Frozen paise snapshots: the only stored money value. The rupee names above read from these. */
  declare subtotalPaise: number;
  declare shippingCostPaise: CreationOptional<number>;
  declare shippingDiscountAmountPaise: CreationOptional<number>;
  declare taxAmountPaise: CreationOptional<number>;
  declare taxableAmountPaise: CreationOptional<number>;
  declare discountAmountPaise: CreationOptional<number>;
  declare commissionAmountPaise: CreationOptional<number>;
  declare tcsAmountPaise: CreationOptional<number>;
  declare netPayoutAmountPaise: CreationOptional<number>;
  declare roundingAdjustmentPaise: CreationOptional<number>;
  /** Vendor-scoped GST tax invoice number allocated at order placement. */
  declare taxInvoiceNumber: CreationOptional<string | null>;
  declare taxInvoiceIssuedAt: CreationOptional<Date | null>;
  /** Tax invoice amounts as issued at checkout; null on sub-orders placed before it existed. */
  declare taxInvoiceSnapshot: CreationOptional<TaxInvoiceSnapshot | null>;
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
      subtotal: paiseBackedRupees('subtotalPaise'),
      shippingCost: paiseBackedRupees('shippingCostPaise'),
      shippingDiscountAmount: paiseBackedRupees('shippingDiscountAmountPaise'),
      shippingCharged: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      customerTotal: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      taxAmount: paiseBackedRupees('taxAmountPaise'),
      taxableAmount: paiseBackedRupees('taxableAmountPaise'),
      taxBreakdown: { type: DataTypes.JSONB, allowNull: true },
      discountAmount: paiseBackedRupees('discountAmountPaise'),
      commissionAmount: paiseBackedRupees('commissionAmountPaise'),
      tcsAmount: paiseBackedRupees('tcsAmountPaise'),
      netPayoutAmount: paiseBackedRupees('netPayoutAmountPaise'),
      subtotalPaise: { type: DataTypes.BIGINT, allowNull: false },
      shippingCostPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      shippingDiscountAmountPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      taxAmountPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      taxableAmountPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      discountAmountPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      commissionAmountPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      tcsAmountPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      netPayoutAmountPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      roundingAdjustmentPaise: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      taxInvoiceNumber: { type: DataTypes.STRING(64), allowNull: true, unique: true },
      taxInvoiceIssuedAt: { type: DataTypes.DATE, allowNull: true },
      taxInvoiceSnapshot: { type: DataTypes.JSONB, allowNull: true },
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
