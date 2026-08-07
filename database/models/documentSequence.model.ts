import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class DocumentSequence extends Model<
  InferAttributes<DocumentSequence>,
  InferCreationAttributes<DocumentSequence>
> {
  declare id: CreationOptional<string>;
  declare kind: string;
  declare nextValue: number;
  declare prefix: string;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
}

export const initDocumentSequenceModel = (sequelize: Sequelize) => {
  DocumentSequence.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      kind: { type: DataTypes.STRING(32), allowNull: false, unique: true },
      nextValue: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      prefix: { type: DataTypes.STRING(16), allowNull: false },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'document_sequences', timestamps: true, paranoid: false },
  );
  return DocumentSequence;
};
