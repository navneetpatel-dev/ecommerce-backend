import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class Address extends Model<InferAttributes<Address>, InferCreationAttributes<Address>> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare line1: string;
  declare line2: string | null;
  declare city: string;
  declare state: string;
  declare country: string;
  declare pincode: string;
  /** Buyer GSTIN for B2B e-invoice (optional). */
  declare gstin: CreationOptional<string | null>;
  declare isDefault: CreationOptional<boolean>;
  /** Free-text doorstep notes for delivery agents (e.g. "Leave at front desk"). */
  declare deliveryInstructions: CreationOptional<string | null>;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    Address.belongsTo(models.User, { foreignKey: 'userId' });
  }
}

export const initAddressModel = (sequelize: Sequelize) => {
  Address.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: false },
      line1: { type: DataTypes.STRING, allowNull: false },
      line2: { type: DataTypes.STRING, allowNull: true },
      city: { type: DataTypes.STRING, allowNull: false },
      state: { type: DataTypes.STRING, allowNull: false },
      country: { type: DataTypes.STRING, allowNull: false },
      pincode: { type: DataTypes.STRING, allowNull: false },
      gstin: { type: DataTypes.STRING(20), allowNull: true },
      isDefault: { type: DataTypes.BOOLEAN, defaultValue: false },
      deliveryInstructions: { type: DataTypes.TEXT, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'addresses', timestamps: true, paranoid: true },
  );
  return Address;
};
