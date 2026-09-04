import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import {
  DELIVERY_AGENT_DOCUMENT_TYPE_VALUES,
  type DeliveryAgentDocumentType,
} from '@core/constants/statuses';

/** Agent KYC/verification document — mirrors VendorDocument exactly. */
export class DeliveryAgentDocument extends Model<
  InferAttributes<DeliveryAgentDocument>,
  InferCreationAttributes<DeliveryAgentDocument>
> {
  declare id: CreationOptional<string>;
  declare deliveryAgentId: string;
  declare type: DeliveryAgentDocumentType;
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
    DeliveryAgentDocument.belongsTo(models.DeliveryAgent, { foreignKey: 'deliveryAgentId', as: 'deliveryAgent' });
    DeliveryAgentDocument.belongsTo(models.User, { foreignKey: 'verifiedById', as: 'verifiedBy' });
  }
}

export const initDeliveryAgentDocumentModel = (sequelize: Sequelize) => {
  DeliveryAgentDocument.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      deliveryAgentId: { type: DataTypes.UUID, allowNull: false },
      type: { type: DataTypes.ENUM(...DELIVERY_AGENT_DOCUMENT_TYPE_VALUES), allowNull: false },
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
    { sequelize, tableName: 'delivery_agent_documents', timestamps: true, paranoid: true },
  );
  return DeliveryAgentDocument;
};
