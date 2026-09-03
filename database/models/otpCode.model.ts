import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';

export type OtpPurpose = 'LOGIN' | 'DELIVERY_CONFIRMATION' | 'RETURN_PICKUP_CONFIRMATION';

export class OtpCode extends Model<InferAttributes<OtpCode>, InferCreationAttributes<OtpCode>> {
  declare id: CreationOptional<string>;
  declare userId: string | null;
  declare channel: CreationOptional<'EMAIL'>;
  declare purpose: OtpPurpose;
  declare codeHash: string;
  declare expiresAt: Date;
  declare consumedAt: CreationOptional<Date | null>;
  declare attempts: CreationOptional<number>;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    OtpCode.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  }
}

export const initOtpCodeModel = (sequelize: Sequelize) => {
  OtpCode.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: true },
      channel: { type: DataTypes.ENUM('EMAIL'), allowNull: false, defaultValue: 'EMAIL' },
      purpose: {
        type: DataTypes.ENUM('LOGIN', 'DELIVERY_CONFIRMATION', 'RETURN_PICKUP_CONFIRMATION'),
        allowNull: false,
      },
      codeHash: { type: DataTypes.STRING, allowNull: false },
      expiresAt: { type: DataTypes.DATE, allowNull: false },
      consumedAt: { type: DataTypes.DATE, allowNull: true },
      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'otp_codes', timestamps: true },
  );
  return OtpCode;
};
