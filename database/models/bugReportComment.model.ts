import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  NonAttribute,
} from 'sequelize';

export class BugReportComment extends Model<
  InferAttributes<BugReportComment>,
  InferCreationAttributes<BugReportComment>
> {
  declare id: CreationOptional<string>;
  declare bugReportId: string;
  declare authorId: string;
  declare body: string;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  declare author?: NonAttribute<{ id: string; name: string }>;

  static associate(models: Record<string, any>) {
    BugReportComment.belongsTo(models.BugReport, { foreignKey: 'bugReportId', as: 'bugReport' });
    BugReportComment.belongsTo(models.User, { foreignKey: 'authorId', as: 'author' });
  }
}

export const initBugReportCommentModel = (sequelize: Sequelize) => {
  BugReportComment.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      bugReportId: { type: DataTypes.UUID, allowNull: false },
      authorId: { type: DataTypes.UUID, allowNull: false },
      body: { type: DataTypes.TEXT, allowNull: false },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'bug_report_comments', timestamps: true, paranoid: true },
  );
  return BugReportComment;
};
