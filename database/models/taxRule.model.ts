import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class TaxRule extends Model<InferAttributes<TaxRule>, InferCreationAttributes<TaxRule>> {
  declare id: CreationOptional<string>;
  declare categoryId: string | null;
  declare hsnCode: string | null;
  declare gstPercentage: number;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;
}

export const initTaxRuleModel = (sequelize: Sequelize) => {
  TaxRule.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      categoryId: { type: DataTypes.UUID, allowNull: true },
      hsnCode: { type: DataTypes.STRING, allowNull: true },
      gstPercentage: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'tax_rules', timestamps: true, paranoid: true },
  );
  return TaxRule;
};
