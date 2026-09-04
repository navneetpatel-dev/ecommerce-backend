import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

/** Full per-attempt failure history — Shipment only ever kept the latest note/count. */
export class ShipmentAttempt extends Model<
  InferAttributes<ShipmentAttempt>,
  InferCreationAttributes<ShipmentAttempt>
> {
  declare id: CreationOptional<string>;
  declare shipmentId: string;
  declare attemptNumber: number;
  declare note: string;
  declare photoUrl: CreationOptional<string | null>;
  declare attemptedAt: Date;
  declare createdBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    ShipmentAttempt.belongsTo(models.Shipment, { foreignKey: 'shipmentId', as: 'shipment' });
  }
}

export const initShipmentAttemptModel = (sequelize: Sequelize) => {
  ShipmentAttempt.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      shipmentId: { type: DataTypes.UUID, allowNull: false },
      attemptNumber: { type: DataTypes.INTEGER, allowNull: false },
      note: { type: DataTypes.TEXT, allowNull: false },
      photoUrl: { type: DataTypes.STRING, allowNull: true },
      attemptedAt: { type: DataTypes.DATE, allowNull: false },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'shipment_attempts', timestamps: true },
  );
  return ShipmentAttempt;
};
