import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class Review extends Model<InferAttributes<Review>, InferCreationAttributes<Review>> {
  declare id: CreationOptional<string>;
  declare productId: string;
  declare userId: string;
  declare orderItemId: string;
  declare rating: number;
  declare title: string | null;
  declare body: string;
  declare status: 'PENDING' | 'APPROVED' | 'REJECTED';
  declare helpfulCount: CreationOptional<number>;
  declare unhelpfulCount: CreationOptional<number>;
  declare vendorResponse: string | null;
  declare vendorRespondedAt: Date | null;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    Review.belongsTo(models.Product, { as: 'product', foreignKey: 'productId' });
    Review.belongsTo(models.User, { as: 'user', foreignKey: 'userId' });
    Review.belongsTo(models.OrderItem, { foreignKey: 'orderItemId' });
    Review.hasMany(models.ReviewVote, { foreignKey: 'reviewId' });
  }
}

export const initReviewModel = (sequelize: Sequelize) => {
  Review.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      productId: { type: DataTypes.UUID, allowNull: false },
      userId: { type: DataTypes.UUID, allowNull: false },
      orderItemId: { type: DataTypes.UUID, allowNull: false, unique: true },
      rating: { type: DataTypes.SMALLINT, allowNull: false, validate: { min: 1, max: 5 } },
      title: { type: DataTypes.STRING, allowNull: true },
      body: { type: DataTypes.TEXT, allowNull: false },
      status: { type: DataTypes.ENUM('PENDING', 'APPROVED', 'REJECTED'), defaultValue: 'PENDING' },
      helpfulCount: { type: DataTypes.INTEGER, defaultValue: 0 },
      unhelpfulCount: { type: DataTypes.INTEGER, defaultValue: 0 },
      vendorResponse: { type: DataTypes.TEXT, allowNull: true },
      vendorRespondedAt: { type: DataTypes.DATE, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'reviews', timestamps: true, paranoid: true },
  );
  return Review;
};
