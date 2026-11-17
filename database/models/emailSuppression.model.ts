import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

/** An address that hard-bounced: mail to it is skipped until the entry expires. */
export class EmailSuppression extends Model<InferAttributes<EmailSuppression>, InferCreationAttributes<EmailSuppression>> {
  declare id: CreationOptional<string>;
  declare email: string;
  declare reason: string;
  declare expiresAt: Date;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
}

export const initEmailSuppressionModel = (sequelize: Sequelize) => {
  EmailSuppression.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      reason: { type: DataTypes.TEXT, allowNull: false },
      expiresAt: { type: DataTypes.DATE, allowNull: false },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'email_suppressions', timestamps: true, paranoid: false },
  );
  return EmailSuppression;
};
