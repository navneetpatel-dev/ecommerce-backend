import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class ProductQuestion extends Model<InferAttributes<ProductQuestion>, InferCreationAttributes<ProductQuestion>> {
  declare id: CreationOptional<string>;
  declare productId: string;
  declare userId: string;
  declare question: string;
  declare status: 'PENDING' | 'PUBLISHED' | 'REJECTED';
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    ProductQuestion.belongsTo(models.Product, { as: 'product', foreignKey: 'productId' });
    ProductQuestion.belongsTo(models.User, { as: 'user', foreignKey: 'userId' });
    ProductQuestion.hasMany(models.ProductAnswer, { as: 'answers', foreignKey: 'questionId' });
  }
}

export const initProductQuestionModel = (sequelize: Sequelize) => {
  ProductQuestion.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      productId: { type: DataTypes.UUID, allowNull: false },
      userId: { type: DataTypes.UUID, allowNull: false },
      question: { type: DataTypes.TEXT, allowNull: false },
      status: { type: DataTypes.ENUM('PENDING', 'PUBLISHED', 'REJECTED'), defaultValue: 'PENDING' },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'product_questions', timestamps: true, paranoid: true },
  );
  return ProductQuestion;
};
