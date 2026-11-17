import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export type ReviewMediaItem = {
  url: string;
  type: 'IMAGE' | 'VIDEO';
  durationSeconds: number | null;
};

/** A proposed edit of an approved review (shown only to its author and moderators). */
export type ReviewRevision = {
  rating: number;
  title: string | null;
  body: string;
  media: ReviewMediaItem[];
  submittedAt: string;
};

export class Review extends Model<InferAttributes<Review>, InferCreationAttributes<Review>> {
  declare id: CreationOptional<string>;
  declare productId: string;
  declare userId: string;
  declare orderItemId: string;
  declare rating: number;
  declare title: string | null;
  declare body: CreationOptional<string>;
  declare status: 'PENDING' | 'APPROVED' | 'REJECTED';
  declare helpfulCount: CreationOptional<number>;
  declare unhelpfulCount: CreationOptional<number>;
  /** Photos and at most one video, shown once the review is approved. */
  declare media: CreationOptional<ReviewMediaItem[]>;
  declare vendorResponse: string | null;
  declare vendorRespondedAt: Date | null;
  declare flaggedReason: CreationOptional<string | null>;
  declare flaggedAt: CreationOptional<Date | null>;
  declare flaggedBy: CreationOptional<string | null>;
  declare editedAt: CreationOptional<Date | null>;
  /** An edit of the approved version, awaiting moderation (the live fields stay public). */
  declare pendingRevision: CreationOptional<ReviewRevision | null>;
  /** When the author's last edit was turned down (cleared by their next edit). */
  declare revisionRejectedAt: CreationOptional<Date | null>;
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
      body: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
      status: { type: DataTypes.ENUM('PENDING', 'APPROVED', 'REJECTED'), defaultValue: 'PENDING' },
      helpfulCount: { type: DataTypes.INTEGER, defaultValue: 0 },
      unhelpfulCount: { type: DataTypes.INTEGER, defaultValue: 0 },
      media: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      vendorResponse: { type: DataTypes.TEXT, allowNull: true },
      vendorRespondedAt: { type: DataTypes.DATE, allowNull: true },
      flaggedReason: { type: DataTypes.STRING(500), allowNull: true },
      flaggedAt: { type: DataTypes.DATE, allowNull: true },
      flaggedBy: { type: DataTypes.UUID, allowNull: true },
      editedAt: { type: DataTypes.DATE, allowNull: true },
      pendingRevision: { type: DataTypes.JSONB, allowNull: true },
      revisionRejectedAt: { type: DataTypes.DATE, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'reviews',
      timestamps: true,
      paranoid: true,
      // Product lists count approved reviews per product (migration 20261112000002).
      indexes: [{ name: 'reviews_product_id_status_live', fields: ['productId', 'status'], where: { deletedAt: null } }],
    },
  );
  return Review;
};
