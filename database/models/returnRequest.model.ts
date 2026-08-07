import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import {
  RETURN_REASON_VALUES,
  RETURN_STATUS,
  RETURN_STATUS_VALUES,
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
  declare status: ReturnStatus;
  declare refundAmount: number | null;
  declare refundTaxAmount: CreationOptional<number | null>;
  declare refundCommissionAmount: CreationOptional<number | null>;
  declare refundTcsAmount: CreationOptional<number | null>;
  declare refundNetClawback: CreationOptional<number | null>;
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
      status: {
        type: DataTypes.ENUM(...RETURN_STATUS_VALUES),
        defaultValue: RETURN_STATUS.REQUESTED,
      },
      refundAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      refundTaxAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      refundCommissionAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      refundTcsAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      refundNetClawback: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
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
