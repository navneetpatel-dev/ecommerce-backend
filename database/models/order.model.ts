import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class Order extends Model<InferAttributes<Order>, InferCreationAttributes<Order>> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare couponId: string | null;
  /** Coupon ids applied at checkout (platform + vendor stack). */
  declare appliedCouponIds: CreationOptional<string[]>;
  declare totalAmount: number;
  declare discountTotal: CreationOptional<number>;
  declare status: 'PENDING' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'RETURNED';
  declare paymentStatus: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  declare paymentMethod: CreationOptional<'RAZORPAY' | 'COD' | null>;
  declare walletAmountUsed: CreationOptional<number>;
  declare pendingCashbackAmount: CreationOptional<number>;
  declare cashbackCreditedAt: CreationOptional<Date | null>;
  declare cashbackDiscountBearer: CreationOptional<'PLATFORM' | 'VENDOR' | null>;
  /** Frozen checkout grand total (stable for refund payment-source splits). */
  declare originalTotalAmount: CreationOptional<number>;
  /** Razorpay-charged portion at checkout (originalTotal − wallet). */
  declare razorpayAmountPaid: CreationOptional<number>;
  /** Vendor that bears VENDOR cashback (coupon.vendorId). */
  declare cashbackVendorId: CreationOptional<string | null>;
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
    Order.belongsTo(models.User, { as: 'user', foreignKey: 'userId' });
    Order.belongsTo(models.Coupon, { as: 'coupon', foreignKey: 'couponId' });
    Order.belongsTo(models.Address, { as: 'shippingAddress', foreignKey: 'shippingAddressId' });
    Order.hasMany(models.SubOrder, { foreignKey: 'orderId', as: 'subOrders' });
  }
}

export const initOrderModel = (sequelize: Sequelize) => {
  Order.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: false },
      couponId: { type: DataTypes.UUID, allowNull: true },
      appliedCouponIds: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      totalAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      discountTotal: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
      status: {
        type: DataTypes.ENUM('PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED'),
        defaultValue: 'PENDING',
      },
      paymentStatus: { type: DataTypes.ENUM('PENDING', 'PAID', 'FAILED', 'REFUNDED'), defaultValue: 'PENDING' },
      paymentMethod: { type: DataTypes.ENUM('RAZORPAY', 'COD'), allowNull: true },
      walletAmountUsed: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      pendingCashbackAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      cashbackCreditedAt: { type: DataTypes.DATE, allowNull: true },
      cashbackDiscountBearer: { type: DataTypes.ENUM('PLATFORM', 'VENDOR'), allowNull: true },
      originalTotalAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      razorpayAmountPaid: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      cashbackVendorId: { type: DataTypes.UUID, allowNull: true },
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
