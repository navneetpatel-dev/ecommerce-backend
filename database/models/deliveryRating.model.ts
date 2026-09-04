import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

/** One optional customer rating per delivered shipment — feeds the agent's average score. */
export class DeliveryRating extends Model<
  InferAttributes<DeliveryRating>,
  InferCreationAttributes<DeliveryRating>
> {
  declare id: CreationOptional<string>;
  declare shipmentId: string;
  declare userId: string;
  declare deliveryAgentId: string;
  declare rating: number;
  declare comment: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    DeliveryRating.belongsTo(models.Shipment, { foreignKey: 'shipmentId', as: 'shipment' });
    DeliveryRating.belongsTo(models.DeliveryAgent, { foreignKey: 'deliveryAgentId', as: 'deliveryAgent' });
    DeliveryRating.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  }
}

export const initDeliveryRatingModel = (sequelize: Sequelize) => {
  DeliveryRating.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      shipmentId: { type: DataTypes.UUID, allowNull: false, unique: true },
      userId: { type: DataTypes.UUID, allowNull: false },
      deliveryAgentId: { type: DataTypes.UUID, allowNull: false },
      rating: { type: DataTypes.INTEGER, allowNull: false },
      comment: { type: DataTypes.TEXT, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'delivery_ratings', timestamps: true },
  );
  return DeliveryRating;
};
