import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import type { ModelRegistry } from './index';

export class StockAlert extends Model<InferAttributes<StockAlert>, InferCreationAttributes<StockAlert>> {
  declare id: CreationOptional<string>;
  declare userId: string | null;
  declare guestEmail: string | null;
  declare variantId: string;
  declare notifiedAt: CreationOptional<Date | null>;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;

  static associate(models: ModelRegistry) {
    StockAlert.belongsTo(models.User, { as: 'user', foreignKey: 'userId' });
    StockAlert.belongsTo(models.ProductVariant, { as: 'variant', foreignKey: 'variantId' });
  }
}

export const initStockAlertModel = (sequelize: Sequelize) => {
  StockAlert.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: true },
      guestEmail: { type: DataTypes.STRING, allowNull: true },
      variantId: { type: DataTypes.UUID, allowNull: false },
      notifiedAt: { type: DataTypes.DATE, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'stock_alerts',
      timestamps: true,
    },
  );
  return StockAlert;
};
