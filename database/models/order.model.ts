import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class Order extends Model<InferAttributes<Order>, InferCreationAttributes<Order>> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare couponId: string | null;
  declare totalAmount: number;
  declare discountTotal: CreationOptional<number>;
  declare status: 'PENDING' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'RETURNED';
  declare paymentStatus: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  declare shippingAddressId: string;
  declare razorpayOrderId: string | null;
  declare razorpayPaymentId: string | null;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    Order.belongsTo(models.User, { foreignKey: 'userId' });
    Order.belongsTo(models.Coupon, { foreignKey: 'couponId' });
    Order.belongsTo(models.Address, { foreignKey: 'shippingAddressId' });
    Order.hasMany(models.SubOrder, { foreignKey: 'orderId', as: 'subOrders' });
  }
}

export const initOrderModel = (sequelize: Sequelize) => {
  Order.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: false },
      couponId: { type: DataTypes.UUID, allowNull: true },
      totalAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      discountTotal: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
      status: {
        type: DataTypes.ENUM('PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED'),
        defaultValue: 'PENDING',
      },
      paymentStatus: { type: DataTypes.ENUM('PENDING', 'PAID', 'FAILED', 'REFUNDED'), defaultValue: 'PENDING' },
      shippingAddressId: { type: DataTypes.UUID, allowNull: false },
      razorpayOrderId: { type: DataTypes.STRING, allowNull: true },
      razorpayPaymentId: { type: DataTypes.STRING, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'orders', timestamps: true, paranoid: true },
  );
  return Order;
};
