import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import {
  VENDOR_DOCUMENT_TYPE_VALUES,
  VENDOR_ENTITY_TYPE_VALUES,
  type VendorDocumentType,
  type VendorEntityType,
} from '@core/constants/statuses';

export class DocumentRequirement extends Model<
  InferAttributes<DocumentRequirement>,
  InferCreationAttributes<DocumentRequirement>
> {
  declare id: CreationOptional<string>;
  /** Null = required for all entity types. */
  declare entityType: VendorEntityType | null;
  /** Null = not category-specific. */
  declare categoryId: string | null;
  declare documentType: VendorDocumentType;
  declare isMandatory: CreationOptional<boolean>;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    DocumentRequirement.belongsTo(models.Category, { foreignKey: 'categoryId', as: 'category' });
  }
}

export const initDocumentRequirementModel = (sequelize: Sequelize) => {
  DocumentRequirement.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      entityType: { type: DataTypes.ENUM(...VENDOR_ENTITY_TYPE_VALUES), allowNull: true },
      categoryId: { type: DataTypes.UUID, allowNull: true },
      documentType: { type: DataTypes.ENUM(...VENDOR_DOCUMENT_TYPE_VALUES), allowNull: false },
      isMandatory: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'document_requirements', timestamps: true, paranoid: true },
  );
  return DocumentRequirement;
};
