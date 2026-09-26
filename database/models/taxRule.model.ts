import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class TaxRule extends Model<InferAttributes<TaxRule>, InferCreationAttributes<TaxRule>> {
  declare id: CreationOptional<string>;
  declare categoryId: string | null;
  declare hsnCode: string | null;
  declare gstPercentage: number;
  /** Per-piece value (₹) above which `gstPercentageAbove` applies; null: one flat rate. */
  declare priceBandThreshold: CreationOptional<number | null>;
  declare gstPercentageAbove: CreationOptional<number | null>;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    TaxRule.belongsTo(models.Category, { as: 'category', foreignKey: 'categoryId' });
  }
}

export const initTaxRuleModel = (sequelize: Sequelize) => {
  TaxRule.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      categoryId: { type: DataTypes.UUID, allowNull: true },
      hsnCode: { type: DataTypes.STRING, allowNull: true },
      gstPercentage: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
      priceBandThreshold: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      gstPercentageAbove: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
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
