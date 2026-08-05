import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class CartItem extends Model<InferAttributes<CartItem>, InferCreationAttributes<CartItem>> {
  declare id: CreationOptional<string>;
  declare cartId: string;
  declare variantId: string;
  declare quantity: CreationOptional<number>;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    CartItem.belongsTo(models.Cart, { foreignKey: 'cartId' });
    CartItem.belongsTo(models.ProductVariant, { foreignKey: 'variantId' });
  }
}

export const initCartItemModel = (sequelize: Sequelize) => {
  CartItem.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      cartId: { type: DataTypes.UUID, allowNull: false },
      variantId: { type: DataTypes.UUID, allowNull: false },
      quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'cart_items', timestamps: true, paranoid: true },
  );
  return CartItem;
};
