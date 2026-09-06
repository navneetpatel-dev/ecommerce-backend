import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class ProductAnswer extends Model<InferAttributes<ProductAnswer>, InferCreationAttributes<ProductAnswer>> {
  declare id: CreationOptional<string>;
  declare questionId: string;
  declare authorId: string;
  declare authorType: 'VENDOR' | 'CUSTOMER';
  declare answer: string;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    ProductAnswer.belongsTo(models.ProductQuestion, { as: 'question', foreignKey: 'questionId' });
    ProductAnswer.belongsTo(models.User, { as: 'author', foreignKey: 'authorId' });
  }
}

export const initProductAnswerModel = (sequelize: Sequelize) => {
  ProductAnswer.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      questionId: { type: DataTypes.UUID, allowNull: false },
      authorId: { type: DataTypes.UUID, allowNull: false },
      authorType: { type: DataTypes.ENUM('VENDOR', 'CUSTOMER'), allowNull: false },
      answer: { type: DataTypes.TEXT, allowNull: false },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'product_answers', timestamps: true, paranoid: true },
  );
  return ProductAnswer;
};
