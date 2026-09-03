import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';

export class WebVital extends Model<InferAttributes<WebVital>, InferCreationAttributes<WebVital>> {
  declare id: CreationOptional<string>;
  declare name: string;
  declare value: number;
  declare rating: string | null;
  declare path: string | null;
  declare effectiveType: string | null;
  declare userId: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
}

export const initWebVitalModel = (sequelize: Sequelize) => {
  WebVital.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      name: { type: DataTypes.STRING(16), allowNull: false },
      value: { type: DataTypes.FLOAT, allowNull: false },
      rating: { type: DataTypes.STRING(32), allowNull: true },
      path: { type: DataTypes.STRING(512), allowNull: true },
      effectiveType: { type: DataTypes.STRING(16), allowNull: true },
      userId: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'web_vitals',
      timestamps: true,
      paranoid: false,
    },
  );
  return WebVital;
};
