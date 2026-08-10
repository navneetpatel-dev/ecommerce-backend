import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import {
  VENDOR_DOCUMENT_TYPE_VALUES,
  type VendorDocumentType,
} from '@core/constants/statuses';

export class VendorDocument extends Model<InferAttributes<VendorDocument>, InferCreationAttributes<VendorDocument>> {
  declare id: CreationOptional<string>;
  declare vendorId: string;
  declare type: VendorDocumentType;
  declare url: string;
  declare verified: CreationOptional<boolean>;
  declare verifiedById: string | null;
  declare rejectionReason: string | null;
  declare rejectedAt: Date | null;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    VendorDocument.belongsTo(models.Vendor, { foreignKey: 'vendorId' });
    VendorDocument.belongsTo(models.User, { foreignKey: 'verifiedById', as: 'verifiedBy' });
  }
}

export const initVendorDocumentModel = (sequelize: Sequelize) => {
  VendorDocument.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      vendorId: { type: DataTypes.UUID, allowNull: false },
      type: { type: DataTypes.ENUM(...VENDOR_DOCUMENT_TYPE_VALUES), allowNull: false },
      url: { type: DataTypes.STRING, allowNull: false },
      verified: { type: DataTypes.BOOLEAN, defaultValue: false },
      verifiedById: { type: DataTypes.UUID, allowNull: true },
      rejectionReason: { type: DataTypes.TEXT, allowNull: true },
      rejectedAt: { type: DataTypes.DATE, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'vendor_documents', timestamps: true, paranoid: true },
  );
  return VendorDocument;
};
