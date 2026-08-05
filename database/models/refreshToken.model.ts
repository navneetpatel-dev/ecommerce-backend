import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class RefreshToken extends Model<InferAttributes<RefreshToken>, InferCreationAttributes<RefreshToken>> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare tokenHash: string;
  declare expiresAt: Date;
  declare family: string;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    RefreshToken.belongsTo(models.User, { foreignKey: 'userId' });
  }
}

export const initRefreshTokenModel = (sequelize: Sequelize) => {
  RefreshToken.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: false },
      tokenHash: { type: DataTypes.STRING, allowNull: false },
      expiresAt: { type: DataTypes.DATE, allowNull: false },
      family: { type: DataTypes.STRING, allowNull: false },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'refresh_tokens', timestamps: true, paranoid: true },
  );
  return RefreshToken;
};
