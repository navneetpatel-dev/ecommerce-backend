import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export type ReportExportStatus = 'SYNC' | 'PENDING' | 'READY' | 'FAILED';

export class ReportExportLog extends Model<
  InferAttributes<ReportExportLog>,
  InferCreationAttributes<ReportExportLog>
> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare reportType: string;
  declare filtersUsed: CreationOptional<Record<string, unknown>>;
  declare format: CreationOptional<string>;
  declare status: CreationOptional<ReportExportStatus>;
  declare rowCount: CreationOptional<number>;
  declare fileKey: string | null;
  declare fileUrl: string | null;
  declare errorMessage: string | null;
  declare exportedAt: CreationOptional<Date>;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    ReportExportLog.belongsTo(models.User, { foreignKey: 'userId' });
  }
}

export const initReportExportLogModel = (sequelize: Sequelize) => {
  ReportExportLog.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: false },
      reportType: { type: DataTypes.STRING(64), allowNull: false },
      filtersUsed: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      format: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'xlsx' },
      status: {
        type: DataTypes.ENUM('SYNC', 'PENDING', 'READY', 'FAILED'),
        allowNull: false,
        defaultValue: 'SYNC',
      },
      rowCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      fileKey: { type: DataTypes.STRING(512), allowNull: true },
      fileUrl: { type: DataTypes.STRING(1024), allowNull: true },
      errorMessage: { type: DataTypes.TEXT, allowNull: true },
      exportedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'report_export_logs', timestamps: true, paranoid: true },
  );
  return ReportExportLog;
};
