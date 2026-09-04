import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class Shipment extends Model<InferAttributes<Shipment>, InferCreationAttributes<Shipment>> {
  declare id: CreationOptional<string>;
  declare subOrderId: string;
  declare carrier: string;
  declare trackingNumber: string;
  declare trackingUrl: string | null;
  declare status:
    | 'PENDING'
    | 'PICKED_UP'
    | 'IN_TRANSIT'
    | 'OUT_FOR_DELIVERY'
    | 'DELIVERED'
    | 'FAILED'
    | 'RTO_INITIATED'
    | 'RTO_DELIVERED';
  declare estimatedDeliveryDate: Date | null;
  declare shippedAt: Date | null;
  declare deliveredAt: Date | null;
  declare deliveryAgentId: CreationOptional<string | null>;
  declare assignedAt: CreationOptional<Date | null>;
  declare proofOfDeliveryUrl: CreationOptional<string | null>;
  declare deliveryOtpVerifiedAt: CreationOptional<Date | null>;
  /** Reason recorded on the most recent FAILED attempt. */
  declare failureReason: CreationOptional<string | null>;
  /** Count of FAILED attempts — 3rd auto-transitions to RTO_INITIATED. */
  declare failedAttemptCount: CreationOptional<number>;
  declare lastFailedAttemptAt: CreationOptional<Date | null>;
  /** Cash due from the customer at doorstep; null when prepaid. */
  declare codAmount: CreationOptional<number | null>;
  declare codCollected: CreationOptional<boolean>;
  declare codCollectedAt: CreationOptional<Date | null>;
  /** Customer-chosen redelivery window after a failed attempt. */
  declare preferredRedeliverySlot: CreationOptional<string | null>;
  /** Vendor's OTP-verified acknowledgment that they received an RTO parcel back. */
  declare rtoHandoverOtpVerifiedAt: CreationOptional<Date | null>;
  declare rtoConfirmedAt: CreationOptional<Date | null>;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    Shipment.belongsTo(models.SubOrder, { foreignKey: 'subOrderId', as: 'subOrder' });
    Shipment.belongsTo(models.DeliveryAgent, { foreignKey: 'deliveryAgentId', as: 'deliveryAgent' });
    Shipment.hasMany(models.ShipmentAttempt, { foreignKey: 'shipmentId', as: 'attempts' });
  }
}

export const initShipmentModel = (sequelize: Sequelize) => {
  Shipment.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      subOrderId: { type: DataTypes.UUID, allowNull: false, unique: true },
      carrier: { type: DataTypes.STRING, allowNull: false },
      trackingNumber: { type: DataTypes.STRING, allowNull: false },
      trackingUrl: { type: DataTypes.STRING, allowNull: true },
      status: {
        type: DataTypes.ENUM(
          'PENDING',
          'PICKED_UP',
          'IN_TRANSIT',
          'OUT_FOR_DELIVERY',
          'DELIVERED',
          'FAILED',
          'RTO_INITIATED',
          'RTO_DELIVERED',
        ),
        defaultValue: 'PENDING',
      },
      estimatedDeliveryDate: { type: DataTypes.DATE, allowNull: true },
      shippedAt: { type: DataTypes.DATE, allowNull: true },
      deliveredAt: { type: DataTypes.DATE, allowNull: true },
      deliveryAgentId: { type: DataTypes.UUID, allowNull: true },
      assignedAt: { type: DataTypes.DATE, allowNull: true },
      proofOfDeliveryUrl: { type: DataTypes.STRING, allowNull: true },
      deliveryOtpVerifiedAt: { type: DataTypes.DATE, allowNull: true },
      failureReason: { type: DataTypes.TEXT, allowNull: true },
      failedAttemptCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      lastFailedAttemptAt: { type: DataTypes.DATE, allowNull: true },
      codAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      codCollected: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      codCollectedAt: { type: DataTypes.DATE, allowNull: true },
      preferredRedeliverySlot: { type: DataTypes.STRING(64), allowNull: true },
      rtoHandoverOtpVerifiedAt: { type: DataTypes.DATE, allowNull: true },
      rtoConfirmedAt: { type: DataTypes.DATE, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'shipments', timestamps: true, paranoid: true },
  );
  return Shipment;
};
