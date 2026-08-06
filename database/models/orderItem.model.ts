import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class OrderItem extends Model<InferAttributes<OrderItem>, InferCreationAttributes<OrderItem>> {
  declare id: CreationOptional<string>;
  declare subOrderId: string;
  declare variantId: string;
  declare productName: string;
  declare quantity: number;
  declare unitPrice: number;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    OrderItem.belongsTo(models.SubOrder, { foreignKey: 'subOrderId', as: 'subOrder' });
    OrderItem.belongsTo(models.ProductVariant, { foreignKey: 'variantId', as: 'variant' });
  }
}

export const initOrderItemModel = (sequelize: Sequelize) => {
  OrderItem.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      subOrderId: { type: DataTypes.UUID, allowNull: false },
      variantId: { type: DataTypes.UUID, allowNull: false },
      productName: { type: DataTypes.STRING, allowNull: false },
      quantity: { type: DataTypes.INTEGER, allowNull: false },
      unitPrice: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'order_items', timestamps: true, paranoid: true },
  );
  return OrderItem;
};
