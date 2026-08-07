import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class Cart extends Model<InferAttributes<Cart>, InferCreationAttributes<Cart>> {
  declare id: CreationOptional<string>;
  declare userId: string | null;
  declare sessionId: string | null;
  declare couponCode: string | null;
  /** Stacked coupon codes (platform + vendor-scoped). Synced with couponCode for legacy. */
  declare couponCodes: CreationOptional<string[]>;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    Cart.hasMany(models.CartItem, { foreignKey: 'cartId', as: 'items' });
  }
}

export const initCartModel = (sequelize: Sequelize) => {
  Cart.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, unique: true, allowNull: true },
      sessionId: { type: DataTypes.STRING, unique: true, allowNull: true },
      couponCode: { type: DataTypes.STRING, allowNull: true },
      couponCodes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'carts', timestamps: true, paranoid: true },
  );
  return Cart;
};
