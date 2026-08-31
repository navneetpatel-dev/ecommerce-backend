import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import {
  REFUND_METHOD_VALUES,
  REFUND_STATUS,
  REFUND_STATUS_VALUES,
  RETURN_REASON_VALUES,
  RETURN_STATUS,
  RETURN_STATUS_VALUES,
  type RefundMethod,
  type RefundStatus,
  type ReturnReason,
  type ReturnStatus,
} from '@core/constants/statuses';

export class ReturnRequest extends Model<InferAttributes<ReturnRequest>, InferCreationAttributes<ReturnRequest>> {
  declare id: CreationOptional<string>;
  declare subOrderId: string;
  declare orderItemId: string;
  declare userId: string;
  declare reason: string;
  declare reasonCode: ReturnReason;
  declare returnQuantity: CreationOptional<number | null>;
  declare status: ReturnStatus;
  declare photoUrls: CreationOptional<string[]>;
  declare refundMethod: CreationOptional<RefundMethod | null>;
  declare refundStatus: CreationOptional<RefundStatus>;
  declare refundAmount: number | null;
  declare refundTaxAmount: CreationOptional<number | null>;
  declare refundCommissionAmount: CreationOptional<number | null>;
  declare refundTcsAmount: CreationOptional<number | null>;
  declare refundNetClawback: CreationOptional<number | null>;
  declare walletRefundAmount: CreationOptional<number>;
  declare razorpayRefundAmount: CreationOptional<number>;
  declare shippingRefundAmount: CreationOptional<number>;
  declare returnShippingFeeAmount: CreationOptional<number>;
  declare razorpayRefundId: CreationOptional<string | null>;
  declare receivedAt: CreationOptional<Date | null>;
  declare resolvedById: string | null;
  declare resolvedAt: Date | null;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    ReturnRequest.belongsTo(models.SubOrder, { foreignKey: 'subOrderId', as: 'subOrder' });
    ReturnRequest.belongsTo(models.OrderItem, { foreignKey: 'orderItemId', as: 'orderItem' });
    ReturnRequest.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    ReturnRequest.hasOne(models.CreditNote, { foreignKey: 'returnRequestId', as: 'creditNote' });
    ReturnRequest.hasOne(models.DebitNote, { foreignKey: 'returnRequestId', as: 'debitNote' });
  }
}

export const initReturnRequestModel = (sequelize: Sequelize) => {
  ReturnRequest.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      subOrderId: { type: DataTypes.UUID, allowNull: false },
      orderItemId: { type: DataTypes.UUID, allowNull: false },
      userId: { type: DataTypes.UUID, allowNull: false },
      reason: { type: DataTypes.TEXT, allowNull: false },
      reasonCode: {
        type: DataTypes.ENUM(...RETURN_REASON_VALUES),
        allowNull: false,
      },
      returnQuantity: { type: DataTypes.INTEGER, allowNull: true },
      status: {
        type: DataTypes.ENUM(...RETURN_STATUS_VALUES),
        defaultValue: RETURN_STATUS.REQUESTED,
      },
      photoUrls: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      refundMethod: { type: DataTypes.ENUM(...REFUND_METHOD_VALUES), allowNull: true },
      refundStatus: {
        type: DataTypes.ENUM(...REFUND_STATUS_VALUES),
        allowNull: false,
        defaultValue: REFUND_STATUS.NONE,
      },
      refundAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      refundTaxAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      refundCommissionAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      refundTcsAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      refundNetClawback: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      walletRefundAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      razorpayRefundAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      shippingRefundAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      returnShippingFeeAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      razorpayRefundId: { type: DataTypes.STRING, allowNull: true },
      receivedAt: { type: DataTypes.DATE, allowNull: true },
      resolvedById: { type: DataTypes.UUID, allowNull: true },
      resolvedAt: { type: DataTypes.DATE, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'return_requests', timestamps: true, paranoid: true },
  );
  return ReturnRequest;
};
