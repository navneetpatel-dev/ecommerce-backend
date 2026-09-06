import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';

export class RecentlyViewedItem extends Model<
  InferAttributes<RecentlyViewedItem>,
  InferCreationAttributes<RecentlyViewedItem>
> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare productId: string;
  declare viewedAt: Date;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    RecentlyViewedItem.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    RecentlyViewedItem.belongsTo(models.Product, { foreignKey: 'productId', as: 'product' });
  }
}

export const initRecentlyViewedItemModel = (sequelize: Sequelize) => {
  RecentlyViewedItem.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: false },
      productId: { type: DataTypes.UUID, allowNull: false },
      viewedAt: { type: DataTypes.DATE, allowNull: false },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'recently_viewed_items',
      timestamps: true,
      indexes: [{ unique: true, fields: ['userId', 'productId'] }],
    },
  );
  return RecentlyViewedItem;
};
