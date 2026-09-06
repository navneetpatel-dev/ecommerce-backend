import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';

/**
 * Precomputed "frequently bought together" pairs — nightly-refreshed by
 * `productAffinity.processor.ts`. Read-only from the API's perspective (no
 * live join), so this deliberately skips paranoid/createdBy-style audit
 * columns used by user-mutated tables — see recentlyViewedItem.model.ts for
 * the same simpler shape on another system-computed table.
 */
export class ProductAffinity extends Model<
  InferAttributes<ProductAffinity>,
  InferCreationAttributes<ProductAffinity>
> {
  declare id: CreationOptional<string>;
  declare productId: string;
  declare relatedProductId: string;
  /** Raw count of orders in the lookback window containing both products. */
  declare coOccurrenceCount: number;
  /** coOccurrenceCount normalized against productId's total order count (0..1 confidence). */
  declare score: number;
  declare computedAt: Date;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    ProductAffinity.belongsTo(models.Product, { foreignKey: 'productId', as: 'product' });
    ProductAffinity.belongsTo(models.Product, { foreignKey: 'relatedProductId', as: 'relatedProduct' });
  }
}

export const initProductAffinityModel = (sequelize: Sequelize) => {
  ProductAffinity.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      productId: { type: DataTypes.UUID, allowNull: false },
      relatedProductId: { type: DataTypes.UUID, allowNull: false },
      coOccurrenceCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      score: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      computedAt: { type: DataTypes.DATE, allowNull: false },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'product_affinities',
      timestamps: true,
      indexes: [{ unique: true, fields: ['productId', 'relatedProductId'] }],
    },
  );
  return ProductAffinity;
};
