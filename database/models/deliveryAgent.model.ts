import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  NonAttribute,
} from 'sequelize';
import type { User } from './user.model';

export type DeliveryVehicleType = 'BIKE' | 'SCOOTER' | 'VAN' | 'BICYCLE';
export type DeliveryAgentStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

export class DeliveryAgent extends Model<
  InferAttributes<DeliveryAgent>,
  InferCreationAttributes<DeliveryAgent>
> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare fullName: string;
  declare phone: string;
  declare vehicleType: CreationOptional<DeliveryVehicleType>;
  declare hubOrZone: string;
  declare status: CreationOptional<DeliveryAgentStatus>;
  declare availableForAssignment: CreationOptional<boolean>;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;
  declare user?: NonAttribute<User>;

  static associate(models: Record<string, any>) {
    DeliveryAgent.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    DeliveryAgent.hasMany(models.Shipment, { foreignKey: 'deliveryAgentId', as: 'shipments' });
    DeliveryAgent.hasMany(models.ReturnRequest, { foreignKey: 'deliveryAgentId', as: 'pickups' });
  }
}

export const initDeliveryAgentModel = (sequelize: Sequelize) => {
  DeliveryAgent.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: false, unique: true },
      fullName: { type: DataTypes.STRING, allowNull: false },
      phone: { type: DataTypes.STRING, allowNull: false },
      vehicleType: { type: DataTypes.ENUM('BIKE', 'SCOOTER', 'VAN', 'BICYCLE'), defaultValue: 'BIKE' },
      hubOrZone: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED'), defaultValue: 'ACTIVE' },
      availableForAssignment: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'delivery_agents', timestamps: true, paranoid: true },
  );
  return DeliveryAgent;
};
