import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';

export class NewsletterSubscriber extends Model<
  InferAttributes<NewsletterSubscriber>,
  InferCreationAttributes<NewsletterSubscriber>
> {
  declare id: CreationOptional<string>;
  declare email: string;
  declare confirmedAt: CreationOptional<Date | null>;
  declare unsubscribedAt: CreationOptional<Date | null>;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
}

export const initNewsletterSubscriberModel = (sequelize: Sequelize) => {
  NewsletterSubscriber.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      confirmedAt: { type: DataTypes.DATE, allowNull: true },
      unsubscribedAt: { type: DataTypes.DATE, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'newsletter_subscribers',
      timestamps: true,
      paranoid: false,
    },
  );
  return NewsletterSubscriber;
};
