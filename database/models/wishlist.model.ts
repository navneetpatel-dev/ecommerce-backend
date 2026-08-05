import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class Wishlist extends Model<InferAttributes<Wishlist>, InferCreationAttributes<Wishlist>> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    Wishlist.belongsTo(models.User, { foreignKey: 'userId' });
    Wishlist.hasMany(models.WishlistItem, { foreignKey: 'wishlistId', as: 'items' });
  }
}

export const initWishlistModel = (sequelize: Sequelize) => {
  Wishlist.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, unique: true, allowNull: false },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'wishlists', timestamps: true, paranoid: true },
  );
  return Wishlist;
};
