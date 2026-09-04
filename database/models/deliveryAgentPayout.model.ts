import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export type DeliveryAgentPayoutStatus = 'PENDING' | 'PAID' | 'FAILED';
export type DeliveryAgentPayoutPaymentMethod =
  | 'NEFT'
  | 'IMPS'
  | 'UPI'
  | 'RTGS'
  | 'CHEQUE'
  | 'CASH'
  | 'OTHER';

/** A batch payout of settled delivery-agent task earnings — mirrors vendor Payout, minus GST/TDS. */
export class DeliveryAgentPayout extends Model<
  InferAttributes<DeliveryAgentPayout>,
  InferCreationAttributes<DeliveryAgentPayout>
> {
  declare id: CreationOptional<string>;
  declare deliveryAgentId: string;
  declare amount: number;
  declare periodStart: Date;
  declare periodEnd: Date;
  declare status: CreationOptional<DeliveryAgentPayoutStatus>;
  declare paymentMethod: DeliveryAgentPayoutPaymentMethod | null;
  declare paymentReferenceNumber: string | null;
  declare proofOfPaymentUrl: string | null;
  declare remarks: string | null;
  declare failureReason: string | null;
  declare paidByAdminId: string | null;
  declare paidAt: Date | null;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    DeliveryAgentPayout.belongsTo(models.DeliveryAgent, { foreignKey: 'deliveryAgentId', as: 'deliveryAgent' });
    DeliveryAgentPayout.belongsTo(models.User, { foreignKey: 'paidByAdminId', as: 'paidByAdmin' });
    DeliveryAgentPayout.hasMany(models.DeliveryAgentEarning, { foreignKey: 'payoutId', as: 'earnings' });
  }
}

export const initDeliveryAgentPayoutModel = (sequelize: Sequelize) => {
  DeliveryAgentPayout.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      deliveryAgentId: { type: DataTypes.UUID, allowNull: false },
      amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      periodStart: { type: DataTypes.DATE, allowNull: false },
      periodEnd: { type: DataTypes.DATE, allowNull: false },
      status: { type: DataTypes.ENUM('PENDING', 'PAID', 'FAILED'), allowNull: false, defaultValue: 'PENDING' },
      paymentMethod: {
        type: DataTypes.ENUM('NEFT', 'IMPS', 'UPI', 'RTGS', 'CHEQUE', 'CASH', 'OTHER'),
        allowNull: true,
      },
      paymentReferenceNumber: { type: DataTypes.STRING, allowNull: true },
      proofOfPaymentUrl: { type: DataTypes.STRING, allowNull: true },
      remarks: { type: DataTypes.TEXT, allowNull: true },
      failureReason: { type: DataTypes.TEXT, allowNull: true },
      paidByAdminId: { type: DataTypes.UUID, allowNull: true },
      paidAt: { type: DataTypes.DATE, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'delivery_agent_payouts', timestamps: true, paranoid: true },
  );
  return DeliveryAgentPayout;
};
