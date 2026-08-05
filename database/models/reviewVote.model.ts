import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class ReviewVote extends Model<InferAttributes<ReviewVote>, InferCreationAttributes<ReviewVote>> {
  declare id: CreationOptional<string>;
  declare reviewId: string;
  declare userId: string;
  declare vote: 'HELPFUL' | 'UNHELPFUL';
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;
}

export const initReviewVoteModel = (sequelize: Sequelize) => {
  ReviewVote.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      reviewId: { type: DataTypes.UUID, allowNull: false },
      userId: { type: DataTypes.UUID, allowNull: false },
      vote: { type: DataTypes.ENUM('HELPFUL', 'UNHELPFUL'), allowNull: false },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'review_votes',
      timestamps: true,
      paranoid: true,
      indexes: [{ unique: true, fields: ['reviewId', 'userId'] }],
    },
  );
  return ReviewVote;
};
