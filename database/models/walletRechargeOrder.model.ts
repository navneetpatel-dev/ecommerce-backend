import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';

export type WalletRechargeStatus = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED';

export class WalletRechargeOrder extends Model<
  InferAttributes<WalletRechargeOrder>,
  InferCreationAttributes<WalletRechargeOrder>
> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare amountInr: number;
  declare pointsCredited: number;
  declare razorpayOrderId: string | null;
  declare razorpayPaymentId: string | null;
  declare status: WalletRechargeStatus;
  declare idempotencyKey: string | null;
  declare creditedLedgerId: string | null;
  declare paidAt: Date | null;
  declare refundStatus: 'NONE' | 'PENDING' | 'INITIATED' | 'COMPLETED' | 'FAILED';
  declare razorpayRefundId: string | null;
  declare refundFailureReason: string | null;
  declare invoiceNumber: string | null;
  declare invoiceGeneratedAt: Date | null;
  declare pointsPerRupee: number | null;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, unknown>) {
    WalletRechargeOrder.belongsTo(models.User as never, { foreignKey: 'userId' });
  }
}

export const initWalletRechargeOrderModel = (sequelize: Sequelize) => {
  WalletRechargeOrder.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: false },
      amountInr: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      pointsCredited: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      razorpayOrderId: { type: DataTypes.STRING(64), allowNull: true },
      razorpayPaymentId: { type: DataTypes.STRING(64), allowNull: true },
      status: {
        type: DataTypes.ENUM('PENDING', 'PAID', 'FAILED', 'EXPIRED'),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      idempotencyKey: { type: DataTypes.STRING(64), allowNull: true },
      creditedLedgerId: { type: DataTypes.UUID, allowNull: true },
      paidAt: { type: DataTypes.DATE, allowNull: true },
      refundStatus: {
        type: DataTypes.ENUM('NONE', 'PENDING', 'INITIATED', 'COMPLETED', 'FAILED'),
        allowNull: false,
        defaultValue: 'NONE',
      },
      razorpayRefundId: { type: DataTypes.STRING(64), allowNull: true },
      refundFailureReason: { type: DataTypes.STRING(255), allowNull: true },
      invoiceNumber: { type: DataTypes.STRING(32), allowNull: true },
      invoiceGeneratedAt: { type: DataTypes.DATE, allowNull: true },
      pointsPerRupee: { type: DataTypes.DECIMAL(8, 2), allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'wallet_recharge_orders', timestamps: true, paranoid: true },
  );
  return WalletRechargeOrder;
};
