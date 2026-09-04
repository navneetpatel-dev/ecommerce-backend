import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export type DeliveryAgentEarningSourceType = 'DELIVERY' | 'PICKUP';
export type DeliveryAgentEarningStatus = 'PENDING' | 'SETTLED';

/** One row per completed delivery/pickup task — the ledger a payout batch settles against. */
export class DeliveryAgentEarning extends Model<
  InferAttributes<DeliveryAgentEarning>,
  InferCreationAttributes<DeliveryAgentEarning>
> {
  declare id: CreationOptional<string>;
  declare deliveryAgentId: string;
  declare sourceType: DeliveryAgentEarningSourceType;
  /** Shipment id (DELIVERY) or ReturnRequest id (PICKUP) — one earning per task, enforced unique. */
  declare sourceId: string;
  /** Snapshot of the per-task rate at completion time — later rate changes never rewrite history. */
  declare amount: number;
  declare status: CreationOptional<DeliveryAgentEarningStatus>;
  declare payoutId: CreationOptional<string | null>;
  declare earnedAt: Date;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    DeliveryAgentEarning.belongsTo(models.DeliveryAgent, { foreignKey: 'deliveryAgentId', as: 'deliveryAgent' });
    DeliveryAgentEarning.belongsTo(models.DeliveryAgentPayout, { foreignKey: 'payoutId', as: 'payout' });
  }
}

export const initDeliveryAgentEarningModel = (sequelize: Sequelize) => {
  DeliveryAgentEarning.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      deliveryAgentId: { type: DataTypes.UUID, allowNull: false },
      sourceType: { type: DataTypes.ENUM('DELIVERY', 'PICKUP'), allowNull: false },
      sourceId: { type: DataTypes.UUID, allowNull: false },
      amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      status: { type: DataTypes.ENUM('PENDING', 'SETTLED'), allowNull: false, defaultValue: 'PENDING' },
      payoutId: { type: DataTypes.UUID, allowNull: true },
      earnedAt: { type: DataTypes.DATE, allowNull: false },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'delivery_agent_earnings', timestamps: true, paranoid: true },
  );
  return DeliveryAgentEarning;
};
