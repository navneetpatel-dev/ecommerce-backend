import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';

export class PushSubscription extends Model<
  InferAttributes<PushSubscription>,
  InferCreationAttributes<PushSubscription>
> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare endpoint: string;
  declare p256dhKey: string;
  declare authKey: string;
  declare userAgent: CreationOptional<string | null>;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    PushSubscription.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  }
}

export const initPushSubscriptionModel = (sequelize: Sequelize) => {
  PushSubscription.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: false },
      endpoint: { type: DataTypes.TEXT, allowNull: false, unique: true },
      p256dhKey: { type: DataTypes.TEXT, allowNull: false },
      authKey: { type: DataTypes.TEXT, allowNull: false },
      userAgent: { type: DataTypes.STRING(512), allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'push_subscriptions', timestamps: true },
  );
  return PushSubscription;
};
