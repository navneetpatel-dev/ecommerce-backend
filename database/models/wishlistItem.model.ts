import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class WishlistItem extends Model<InferAttributes<WishlistItem>, InferCreationAttributes<WishlistItem>> {
  declare id: CreationOptional<string>;
  declare wishlistId: string;
  declare productId: string;
  declare priceAtAdd: number;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    WishlistItem.belongsTo(models.Wishlist, { foreignKey: 'wishlistId' });
    WishlistItem.belongsTo(models.Product, { as: 'product', foreignKey: 'productId' });
  }
}

export const initWishlistItemModel = (sequelize: Sequelize) => {
  WishlistItem.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      wishlistId: { type: DataTypes.UUID, allowNull: false },
      productId: { type: DataTypes.UUID, allowNull: false },
      priceAtAdd: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'wishlist_items',
      timestamps: true,
      paranoid: true,
      indexes: [{ unique: true, fields: ['wishlistId', 'productId'] }],
    },
  );
  return WishlistItem;
};
