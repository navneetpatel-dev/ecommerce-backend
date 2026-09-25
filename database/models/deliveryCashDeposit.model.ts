import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { coerceRupees } from '@modules/pricing/money';
import { cashDepositDiscrepancy } from '@modules/pricing/displayMoney';

export type CashDepositStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

/** End-of-shift COD cash reconciliation: an agent declares what they're handing to the hub. */
export class DeliveryCashDeposit extends Model<
  InferAttributes<DeliveryCashDeposit>,
  InferCreationAttributes<DeliveryCashDeposit>
> {
  declare id: CreationOptional<string>;
  declare deliveryAgentId: string;
  declare amount: number;
  /** COD cash the system expects the agent to be holding at submission time. */
  declare expectedAmount: number;
  declare readonly discrepancyAmount: CreationOptional<number>;
  declare readonly hasDiscrepancy: CreationOptional<boolean>;
  declare status: CreationOptional<CashDepositStatus>;
  declare note: string | null;
  declare rejectionReason: string | null;
  declare verifiedById: string | null;
  declare verifiedAt: Date | null;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    DeliveryCashDeposit.belongsTo(models.DeliveryAgent, { foreignKey: 'deliveryAgentId', as: 'deliveryAgent' });
    DeliveryCashDeposit.belongsTo(models.User, { foreignKey: 'verifiedById', as: 'verifiedBy' });
  }
}

export const initDeliveryCashDepositModel = (sequelize: Sequelize) => {
  DeliveryCashDeposit.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      deliveryAgentId: { type: DataTypes.UUID, allowNull: false },
      amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        // Postgres DECIMAL arrives as a string via Sequelize — coerce at the model
        // boundary so both the admin review panel and the agent's own history card
        // get a real number instead of crashing on `.toFixed()`.
        get(this: DeliveryCashDeposit) {
          return coerceRupees(this.getDataValue('amount'));
        },
      },
      expectedAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        get(this: DeliveryCashDeposit) {
          return coerceRupees(this.getDataValue('expectedAmount'));
        },
      },
      // Computed server-side so no client ever subtracts the two amounts itself.
      discrepancyAmount: {
        type: DataTypes.VIRTUAL,
        get(this: DeliveryCashDeposit) {
          return cashDepositDiscrepancy(this.amount, this.expectedAmount).discrepancyAmount;
        },
      },
      hasDiscrepancy: {
        type: DataTypes.VIRTUAL,
        get(this: DeliveryCashDeposit) {
          return cashDepositDiscrepancy(this.amount, this.expectedAmount).hasDiscrepancy;
        },
      },
      status: { type: DataTypes.ENUM('PENDING', 'VERIFIED', 'REJECTED'), allowNull: false, defaultValue: 'PENDING' },
      note: { type: DataTypes.TEXT, allowNull: true },
      rejectionReason: { type: DataTypes.TEXT, allowNull: true },
      verifiedById: { type: DataTypes.UUID, allowNull: true },
      verifiedAt: { type: DataTypes.DATE, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'delivery_cash_deposits', timestamps: true, paranoid: true },
  );
  return DeliveryCashDeposit;
};
