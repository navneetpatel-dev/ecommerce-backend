import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class CartItem extends Model<InferAttributes<CartItem>, InferCreationAttributes<CartItem>> {
  declare id: CreationOptional<string>;
  declare cartId: string;
  declare variantId: string;
  declare quantity: CreationOptional<number>;
  /** Pre-GST price per piece when the line was added (B-55); set by the create hook. */
  declare unitPriceAtAdd: CreationOptional<number | null>;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    CartItem.belongsTo(models.Cart, { foreignKey: 'cartId' });
    CartItem.belongsTo(models.ProductVariant, { as: 'variant', foreignKey: 'variantId' });
  }
}

export const initCartItemModel = (sequelize: Sequelize) => {
  CartItem.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      cartId: { type: DataTypes.UUID, allowNull: false },
      variantId: { type: DataTypes.UUID, allowNull: false },
      quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      unitPriceAtAdd: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'cart_items',
      timestamps: true,
      paranoid: true,
      hooks: {
        // Every way a line is created (add, guest merge, undo) records the price it went in at.
        async beforeCreate(item, options) {
          if (item.unitPriceAtAdd != null) return;
          const variant = await sequelize.models.ProductVariant?.findByPk(item.variantId, {
            attributes: ['price'],
            transaction: options.transaction,
          });
          item.unitPriceAtAdd = (variant?.get('price') as number | undefined) ?? null;
        },
      },
    },
  );
  return CartItem;
};
