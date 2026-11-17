import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

/** A message sent through the public contact form. */
export class ContactMessage extends Model<InferAttributes<ContactMessage>, InferCreationAttributes<ContactMessage>> {
  declare id: CreationOptional<string>;
  declare userId: string | null;
  declare name: string;
  declare email: string;
  declare topic: string;
  declare subject: string;
  declare message: string;
  /** Short reference quoted in the acknowledgement email, e.g. CM-7F3A9C. */
  declare reference: string;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
}

export const initContactMessageModel = (sequelize: Sequelize) => {
  ContactMessage.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: true },
      name: { type: DataTypes.STRING(120), allowNull: false },
      email: { type: DataTypes.STRING(255), allowNull: false },
      topic: { type: DataTypes.STRING(60), allowNull: false },
      subject: { type: DataTypes.STRING(200), allowNull: false },
      message: { type: DataTypes.TEXT, allowNull: false },
      reference: { type: DataTypes.STRING(20), allowNull: false },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'contact_messages', timestamps: true, paranoid: false },
  );
  return ContactMessage;
};
