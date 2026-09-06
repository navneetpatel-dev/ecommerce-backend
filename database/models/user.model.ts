import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional, NonAttribute } from 'sequelize';
import type { Role } from './role.model';
import type { Vendor } from './vendor.model';
import type { DeliveryAgent } from './deliveryAgent.model';

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare id: CreationOptional<string>;
  declare email: string;
  declare passwordHash: string | null;
  declare googleId: string | null;
  declare name: string;
  declare phone: string | null;
  declare status: 'ACTIVE' | 'BLOCKED';
  declare roleId: string;
  declare vendorId: string | null;
  declare deliveryAgentId: string | null;
  declare emailVerified: CreationOptional<boolean>;
  declare emailMarketingConsent: CreationOptional<boolean>;
  declare emailSuppressed: CreationOptional<boolean>;
  declare avatarUrl: string | null;
  declare razorpayCustomerId: string | null;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  declare role?: NonAttribute<Role>;
  declare vendor?: NonAttribute<Vendor>;
  declare deliveryAgent?: NonAttribute<DeliveryAgent>;

  static associate(models: Record<string, any>) {
    User.belongsTo(models.Role, { foreignKey: 'roleId', as: 'role' });
    User.belongsTo(models.Vendor, { foreignKey: 'vendorId', as: 'vendor' });
    User.belongsTo(models.DeliveryAgent, { foreignKey: 'deliveryAgentId', as: 'deliveryAgent' });
    User.hasMany(models.Address, { foreignKey: 'userId' });
    User.hasMany(models.SavedPaymentMethod, { foreignKey: 'userId', as: 'savedPaymentMethods' });
  }
}

export const initUserModel = (sequelize: Sequelize) => {
  User.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      email: { type: DataTypes.STRING, allowNull: false },
      passwordHash: { type: DataTypes.STRING, allowNull: true },
      googleId: { type: DataTypes.STRING, allowNull: true },
      name: { type: DataTypes.STRING, allowNull: false },
      phone: { type: DataTypes.STRING, allowNull: true },
      status: { type: DataTypes.ENUM('ACTIVE', 'BLOCKED'), defaultValue: 'ACTIVE' },
      roleId: { type: DataTypes.UUID, allowNull: false },
      vendorId: { type: DataTypes.UUID, allowNull: true },
      deliveryAgentId: { type: DataTypes.UUID, allowNull: true },
      emailVerified: { type: DataTypes.BOOLEAN, defaultValue: false },
      emailMarketingConsent: { type: DataTypes.BOOLEAN, defaultValue: false },
      emailSuppressed: { type: DataTypes.BOOLEAN, defaultValue: false },
      avatarUrl: { type: DataTypes.STRING, allowNull: true },
      razorpayCustomerId: { type: DataTypes.STRING, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'users',
      timestamps: true,
      paranoid: true,
      hooks: {
        // Emails are stored lowercase everywhere — this is the last line of
        // defense for any write path that reaches the model directly instead
        // of through a normalized DTO (see auth.dto.ts's `emailSchema`).
        beforeValidate: (user) => {
          if (typeof user.email === 'string') {
            user.email = user.email.trim().toLowerCase();
          }
        },
      },
      indexes: [
        {
          unique: true,
          fields: ['email'],
          name: 'users_email_unique',
          where: { deletedAt: null },
        },
      ],
    },
  );
  return User;
};
