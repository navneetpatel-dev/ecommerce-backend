import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import {
  BUG_ATTACHMENT_TYPE_VALUES,
  type BugAttachmentType,
} from '@core/constants/statuses';

export class BugReportAttachment extends Model<
  InferAttributes<BugReportAttachment>,
  InferCreationAttributes<BugReportAttachment>
> {
  declare id: CreationOptional<string>;
  declare bugReportId: string;
  declare url: string;
  declare type: BugAttachmentType;
  declare durationSeconds: number | null;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    BugReportAttachment.belongsTo(models.BugReport, { foreignKey: 'bugReportId', as: 'bugReport' });
  }
}

export const initBugReportAttachmentModel = (sequelize: Sequelize) => {
  BugReportAttachment.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      bugReportId: { type: DataTypes.UUID, allowNull: false },
      url: { type: DataTypes.STRING(1024), allowNull: false },
      type: {
        type: DataTypes.ENUM(...BUG_ATTACHMENT_TYPE_VALUES),
        allowNull: false,
      },
      durationSeconds: { type: DataTypes.INTEGER, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'bug_report_attachments', timestamps: true, paranoid: true },
  );
  return BugReportAttachment;
};
