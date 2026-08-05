import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class ShippingRate extends Model<InferAttributes<ShippingRate>, InferCreationAttributes<ShippingRate>> {
  declare id: CreationOptional<string>;
  declare zoneId: string;
  declare vendorId: string | null;
  declare method: 'STANDARD' | 'EXPRESS';
  declare minWeightGrams: number;
  declare maxWeightGrams: number;
  declare price: number;
  declare estimatedDays: number;
  declare freeShippingThreshold: number | null;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;
}

export const initShippingRateModel = (sequelize: Sequelize) => {
  ShippingRate.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      zoneId: { type: DataTypes.UUID, allowNull: false },
      vendorId: { type: DataTypes.UUID, allowNull: true },
      method: { type: DataTypes.ENUM('STANDARD', 'EXPRESS'), defaultValue: 'STANDARD' },
      minWeightGrams: { type: DataTypes.INTEGER, defaultValue: 0 },
      maxWeightGrams: { type: DataTypes.INTEGER, allowNull: false },
      price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      estimatedDays: { type: DataTypes.INTEGER, allowNull: false },
      freeShippingThreshold: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'shipping_rates', timestamps: true, paranoid: true },
  );
  return ShippingRate;
};
