import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class ShippingZone extends Model<InferAttributes<ShippingZone>, InferCreationAttributes<ShippingZone>> {
  declare id: CreationOptional<string>;
  declare name: string;
  declare states: CreationOptional<string[]>;
  declare pincodePrefixes: CreationOptional<string[]>;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;
}

export const initShippingZoneModel = (sequelize: Sequelize) => {
  ShippingZone.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      name: { type: DataTypes.STRING, allowNull: false },
      states: { type: DataTypes.ARRAY(DataTypes.STRING), defaultValue: [] },
      pincodePrefixes: { type: DataTypes.ARRAY(DataTypes.STRING), defaultValue: [] },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'shipping_zones', timestamps: true, paranoid: true },
  );
  return ShippingZone;
};
