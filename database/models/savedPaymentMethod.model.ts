import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  NonAttribute,
} from 'sequelize';
import type { User } from './user.model';

/**
 * A Razorpay-tokenized card/UPI instrument saved against a customer.
 * Populated best-effort from `payment.captured` webhook payloads
 * (see payments.service.ts `persistSavedMethodFromPayment`).
 */
export class SavedPaymentMethod extends Model<
  InferAttributes<SavedPaymentMethod>,
  InferCreationAttributes<SavedPaymentMethod>
> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare razorpayCustomerId: string;
  declare razorpayTokenId: string;
  declare methodType: string;
  declare cardLast4: string | null;
  declare cardNetwork: string | null;
  declare vpa: string | null;
  declare metadata: Record<string, unknown> | null;
  declare readonly createdAt: CreationOptional<Date>;

  declare user?: NonAttribute<User>;

  static associate(models: Record<string, any>) {
    SavedPaymentMethod.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  }
}

export const initSavedPaymentMethodModel = (sequelize: Sequelize) => {
  SavedPaymentMethod.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: false },
      razorpayCustomerId: { type: DataTypes.STRING, allowNull: false },
      razorpayTokenId: { type: DataTypes.STRING, allowNull: false },
      methodType: { type: DataTypes.STRING, allowNull: false },
      cardLast4: { type: DataTypes.STRING(4), allowNull: true },
      cardNetwork: { type: DataTypes.STRING, allowNull: true },
      vpa: { type: DataTypes.STRING, allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: true },
      createdAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'saved_payment_methods',
      timestamps: true,
      updatedAt: false,
      indexes: [{ unique: true, fields: ['razorpayTokenId'] }],
    },
  );
  return SavedPaymentMethod;
};
