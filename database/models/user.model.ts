import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional, NonAttribute } from 'sequelize';
import type { Role } from './role.model';
import type { Vendor } from './vendor.model';

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare id: CreationOptional<string>;
  declare email: string;
  declare passwordHash: string;
  declare name: string;
  declare phone: string | null;
  declare status: 'ACTIVE' | 'BLOCKED';
  declare roleId: string;
  declare vendorId: string | null;
  declare emailVerified: CreationOptional<boolean>;
  declare emailMarketingConsent: CreationOptional<boolean>;
  declare emailSuppressed: CreationOptional<boolean>;
  declare avatarUrl: string | null;
  declare pendingEmail: string | null;
  declare notificationPrefs: CreationOptional<{
    orderUpdates: boolean;
    smsAlerts: boolean;
    shippingNotifications: boolean;
  }>;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  declare role?: NonAttribute<Role>;
  declare vendor?: NonAttribute<Vendor>;

  static associate(models: Record<string, any>) {
    User.belongsTo(models.Role, { foreignKey: 'roleId' });
    User.belongsTo(models.Vendor, { foreignKey: 'vendorId' });
    User.hasMany(models.Address, { foreignKey: 'userId' });
  }
}

export const initUserModel = (sequelize: Sequelize) => {
  User.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      email: { type: DataTypes.STRING, unique: true, allowNull: false },
      passwordHash: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      phone: { type: DataTypes.STRING, allowNull: true },
      status: { type: DataTypes.ENUM('ACTIVE', 'BLOCKED'), defaultValue: 'ACTIVE' },
      roleId: { type: DataTypes.UUID, allowNull: false },
      vendorId: { type: DataTypes.UUID, allowNull: true },
      emailVerified: { type: DataTypes.BOOLEAN, defaultValue: false },
      emailMarketingConsent: { type: DataTypes.BOOLEAN, defaultValue: false },
      emailSuppressed: { type: DataTypes.BOOLEAN, defaultValue: false },
      avatarUrl: { type: DataTypes.STRING, allowNull: true },
      pendingEmail: { type: DataTypes.STRING, allowNull: true },
      notificationPrefs: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {
          orderUpdates: true,
          smsAlerts: false,
          shippingNotifications: true,
        },
      },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'users', timestamps: true, paranoid: true },
  );
  return User;
};
