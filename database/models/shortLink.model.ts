import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class ShortLink extends Model<InferAttributes<ShortLink>, InferCreationAttributes<ShortLink>> {
  declare id: CreationOptional<string>;
  declare code: string;
  declare targetUrl: string;
  declare resourceType: CreationOptional<string>;
  declare resourceId: string | null;
  declare metadata: CreationOptional<Record<string, any> | null>;
  declare clicks: CreationOptional<number>;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    ShortLink.belongsTo(models.Product, { as: 'product', foreignKey: 'resourceId', constraints: false });
  }
}

export const initShortLinkModel = (sequelize: Sequelize) => {
  ShortLink.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      code: {
        type: DataTypes.STRING(16),
        allowNull: false,
        unique: true,
      },
      targetUrl: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      resourceType: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'PRODUCT',
      },
      resourceId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      clicks: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'short_links',
      timestamps: true,
    },
  );
  return ShortLink;
};
