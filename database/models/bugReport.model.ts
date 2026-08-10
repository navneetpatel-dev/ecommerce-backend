import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  NonAttribute,
} from 'sequelize';
import {
  BUG_AFFECTED_MODULE,
  BUG_AFFECTED_MODULE_VALUES,
  BUG_REPORT_SEVERITY,
  BUG_REPORT_SEVERITY_VALUES,
  BUG_REPORT_STATUS,
  BUG_REPORT_STATUS_VALUES,
  BUG_REPORTER_ROLE_VALUES,
  type BugAffectedModule,
  type BugReporterRole,
  type BugReportSeverity,
  type BugReportStatus,
} from '@core/constants/statuses';

export class BugReport extends Model<InferAttributes<BugReport>, InferCreationAttributes<BugReport>> {
  declare id: CreationOptional<string>;
  declare reportNumber: string;
  declare reporterId: string;
  declare reporterRole: BugReporterRole;
  declare title: string;
  declare description: string;
  declare stepsToReproduce: string | null;
  declare severity: CreationOptional<BugReportSeverity>;
  declare status: CreationOptional<BugReportStatus>;
  declare duplicateOfId: string | null;
  declare assignedToId: string | null;
  declare affectedModule: CreationOptional<BugAffectedModule>;
  declare pageUrl: string | null;
  declare userAgent: string | null;
  declare browserName: string | null;
  declare osName: string | null;
  declare deviceType: string | null;
  declare appVersion: string | null;
  declare userId: string;
  declare userRole: string;
  declare occurredAt: Date;
  declare triagedAt: Date | null;
  declare resolvedAt: Date | null;
  declare wontFixReason: string | null;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  declare reporter?: NonAttribute<{ id: string; name: string }>;
  declare assignedTo?: NonAttribute<{ id: string; name: string }>;
  declare attachments?: NonAttribute<unknown[]>;
  declare comments?: NonAttribute<unknown[]>;

  static associate(models: Record<string, any>) {
    BugReport.belongsTo(models.User, { foreignKey: 'reporterId', as: 'reporter' });
    BugReport.belongsTo(models.User, { foreignKey: 'assignedToId', as: 'assignedTo' });
    BugReport.belongsTo(models.BugReport, { foreignKey: 'duplicateOfId', as: 'duplicateOf' });
    BugReport.hasMany(models.BugReportAttachment, { foreignKey: 'bugReportId', as: 'attachments' });
    BugReport.hasMany(models.BugReportComment, { foreignKey: 'bugReportId', as: 'comments' });
  }
}

export const initBugReportModel = (sequelize: Sequelize) => {
  BugReport.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      reportNumber: { type: DataTypes.STRING(32), allowNull: false, unique: true },
      reporterId: { type: DataTypes.UUID, allowNull: false },
      reporterRole: {
        type: DataTypes.ENUM(...BUG_REPORTER_ROLE_VALUES),
        allowNull: false,
      },
      title: { type: DataTypes.STRING(255), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: false },
      stepsToReproduce: { type: DataTypes.TEXT, allowNull: true },
      severity: {
        type: DataTypes.ENUM(...BUG_REPORT_SEVERITY_VALUES),
        allowNull: false,
        defaultValue: BUG_REPORT_SEVERITY.MEDIUM,
      },
      status: {
        type: DataTypes.ENUM(...BUG_REPORT_STATUS_VALUES),
        allowNull: false,
        defaultValue: BUG_REPORT_STATUS.NEW,
      },
      duplicateOfId: { type: DataTypes.UUID, allowNull: true },
      assignedToId: { type: DataTypes.UUID, allowNull: true },
      affectedModule: {
        type: DataTypes.ENUM(...BUG_AFFECTED_MODULE_VALUES),
        allowNull: false,
        defaultValue: BUG_AFFECTED_MODULE.OTHER,
      },
      pageUrl: { type: DataTypes.STRING(2048), allowNull: true },
      userAgent: { type: DataTypes.TEXT, allowNull: true },
      browserName: { type: DataTypes.STRING(128), allowNull: true },
      osName: { type: DataTypes.STRING(128), allowNull: true },
      deviceType: { type: DataTypes.STRING(32), allowNull: true },
      appVersion: { type: DataTypes.STRING(64), allowNull: true },
      userId: { type: DataTypes.UUID, allowNull: false },
      userRole: { type: DataTypes.STRING(64), allowNull: false },
      occurredAt: { type: DataTypes.DATE, allowNull: false },
      triagedAt: { type: DataTypes.DATE, allowNull: true },
      resolvedAt: { type: DataTypes.DATE, allowNull: true },
      wontFixReason: { type: DataTypes.TEXT, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'bug_reports', timestamps: true, paranoid: true },
  );
  return BugReport;
};
