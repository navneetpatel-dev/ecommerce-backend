import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class OrderItem extends Model<InferAttributes<OrderItem>, InferCreationAttributes<OrderItem>> {
  declare id: CreationOptional<string>;
  declare subOrderId: string;
  declare variantId: string;
  declare productName: string;
  declare quantity: number;
  declare unitPrice: number;
  /** Pre-discount extended price frozen at checkout. */
  declare lineSubtotal: CreationOptional<number>;
  /** Customer line total after discount, including tax. */
  declare lineTotal: CreationOptional<number>;
  declare discountAmount: CreationOptional<number>;
  declare taxableAmount: CreationOptional<number>;
  declare taxAmount: CreationOptional<number>;
  declare taxBreakdown: CreationOptional<Record<string, unknown> | null>;
  declare commissionAmount: CreationOptional<number>;
  declare tcsAmount: CreationOptional<number>;
  declare netPayoutAmount: CreationOptional<number>;
  declare unitPricePaise: CreationOptional<number | null>;
  declare discountAmountPaise: CreationOptional<number | null>;
  declare taxableAmountPaise: CreationOptional<number | null>;
  declare taxAmountPaise: CreationOptional<number | null>;
  declare commissionAmountPaise: CreationOptional<number | null>;
  declare tcsAmountPaise: CreationOptional<number | null>;
  declare netPayoutAmountPaise: CreationOptional<number | null>;
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
      lineSubtotal: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      lineTotal: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      discountAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      taxableAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      taxAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      taxBreakdown: { type: DataTypes.JSONB, allowNull: true },
      commissionAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      tcsAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      netPayoutAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      unitPricePaise: { type: DataTypes.BIGINT, allowNull: true },
      discountAmountPaise: { type: DataTypes.BIGINT, allowNull: true },
      taxableAmountPaise: { type: DataTypes.BIGINT, allowNull: true },
      taxAmountPaise: { type: DataTypes.BIGINT, allowNull: true },
      commissionAmountPaise: { type: DataTypes.BIGINT, allowNull: true },
      tcsAmountPaise: { type: DataTypes.BIGINT, allowNull: true },
      netPayoutAmountPaise: { type: DataTypes.BIGINT, allowNull: true },
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
