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
  declare subtotalPaise: CreationOptional<number>;
  declare shippingCostPaise: CreationOptional<number>;
  declare shippingDiscountAmountPaise: CreationOptional<number>;
  declare taxAmountPaise: CreationOptional<number>;
  declare taxableAmountPaise: CreationOptional<number>;
  declare discountAmountPaise: CreationOptional<number>;
  declare commissionAmountPaise: CreationOptional<number>;
  declare tcsAmountPaise: CreationOptional<number>;
  declare netPayoutAmountPaise: CreationOptional<number>;
  declare roundingAdjustmentPaise: CreationOptional<number>;
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
      subtotalPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      shippingCostPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      shippingDiscountAmountPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      taxAmountPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      taxableAmountPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      discountAmountPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      commissionAmountPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      tcsAmountPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      netPayoutAmountPaise: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      roundingAdjustmentPaise: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
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
