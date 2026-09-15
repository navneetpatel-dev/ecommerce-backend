import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export type ExportJobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type ExportJobFormat = 'csv' | 'xlsx' | 'pdf';

export class ExportJob extends Model<InferAttributes<ExportJob>, InferCreationAttributes<ExportJob>> {
  declare id: CreationOptional<string>;
  declare ownerId: string;
  declare domain: string;
  declare exportType: string;
  declare format: ExportJobFormat;
  declare status: CreationOptional<ExportJobStatus>;
  declare filters: Record<string, unknown>;
  declare progressPercent: CreationOptional<number>;
  declare rowsProcessed: CreationOptional<number>;
  declare totalRowsEstimate: number | null;
  declare resultKey: string | null;
  declare filename: string | null;
  declare byteSize: number | null;
  declare errorMessage: string | null;
  declare errorCode: string | null;
  declare startedAt: Date | null;
  declare completedAt: Date | null;
  declare expiresAt: Date | null;
  declare acknowledgedAt: Date | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    ExportJob.belongsTo(models.User, { as: 'owner', foreignKey: 'ownerId' });
  }
}

export const initExportJobModel = (sequelize: Sequelize) => {
  ExportJob.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      ownerId: { type: DataTypes.UUID, allowNull: false },
      domain: { type: DataTypes.STRING(40), allowNull: false },
      exportType: { type: DataTypes.STRING(80), allowNull: false },
      format: { type: DataTypes.ENUM('csv', 'xlsx', 'pdf'), allowNull: false },
      status: {
        type: DataTypes.ENUM('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'),
        allowNull: false,
        defaultValue: 'QUEUED',
      },
      filters: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      progressPercent: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      rowsProcessed: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      totalRowsEstimate: { type: DataTypes.INTEGER, allowNull: true },
      resultKey: { type: DataTypes.STRING(512), allowNull: true },
      filename: { type: DataTypes.STRING(255), allowNull: true },
      byteSize: { type: DataTypes.INTEGER, allowNull: true },
      errorMessage: { type: DataTypes.STRING(500), allowNull: true },
      errorCode: { type: DataTypes.STRING(80), allowNull: true },
      startedAt: { type: DataTypes.DATE, allowNull: true },
      completedAt: { type: DataTypes.DATE, allowNull: true },
      expiresAt: { type: DataTypes.DATE, allowNull: true },
      acknowledgedAt: { type: DataTypes.DATE, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'export_jobs', timestamps: true },
  );
  return ExportJob;
};
