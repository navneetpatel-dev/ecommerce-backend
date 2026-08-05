import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class Permission extends Model<InferAttributes<Permission>, InferCreationAttributes<Permission>> {
  declare id: CreationOptional<string>;
  declare key: string;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    Permission.belongsToMany(models.Role, { through: 'RolePermissions', foreignKey: 'permissionId' });
  }
}

export const initPermissionModel = (sequelize: Sequelize) => {
  Permission.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      key: { type: DataTypes.STRING, unique: true, allowNull: false },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'permissions', timestamps: true, paranoid: true },
  );
  return Permission;
};
