import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class ReturnRequest extends Model<InferAttributes<ReturnRequest>, InferCreationAttributes<ReturnRequest>> {
  declare id: CreationOptional<string>;
  declare subOrderId: string;
  declare orderItemId: string;
  declare userId: string;
  declare reason: string;
  declare reasonCode: 'DAMAGED' | 'WRONG_ITEM' | 'NOT_AS_DESCRIBED' | 'NO_LONGER_NEEDED' | 'OTHER';
  declare status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'PICKUP_SCHEDULED' | 'RECEIVED' | 'REFUNDED' | 'CLOSED';
  declare refundAmount: number | null;
  declare resolvedById: string | null;
  declare resolvedAt: Date | null;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    ReturnRequest.belongsTo(models.SubOrder, { foreignKey: 'subOrderId' });
    ReturnRequest.belongsTo(models.OrderItem, { foreignKey: 'orderItemId' });
    ReturnRequest.belongsTo(models.User, { foreignKey: 'userId' });
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
        type: DataTypes.ENUM('DAMAGED', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'NO_LONGER_NEEDED', 'OTHER'),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM('REQUESTED', 'APPROVED', 'REJECTED', 'PICKUP_SCHEDULED', 'RECEIVED', 'REFUNDED', 'CLOSED'),
        defaultValue: 'REQUESTED',
      },
      refundAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
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
