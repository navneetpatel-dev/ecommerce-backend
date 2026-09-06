import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';

export type GiftCardStatusValue = 'PENDING' | 'ACTIVE' | 'REDEEMED' | 'EXPIRED' | 'CANCELLED' | 'FAILED';

export class GiftCard extends Model<InferAttributes<GiftCard>, InferCreationAttributes<GiftCard>> {
  declare id: CreationOptional<string>;
  declare code: string;
  declare amount: number;
  declare purchaserId: string;
  declare recipientEmail: string;
  declare recipientName: string | null;
  declare message: string | null;
  declare redeemedByUserId: string | null;
  declare redeemedAt: Date | null;
  declare expiresAt: Date;
  declare status: GiftCardStatusValue;
  declare razorpayOrderId: string | null;
  declare razorpayPaymentId: string | null;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, unknown>) {
    GiftCard.belongsTo(models.User as never, { foreignKey: 'purchaserId', as: 'purchaser' });
    GiftCard.belongsTo(models.User as never, { foreignKey: 'redeemedByUserId', as: 'redeemer' });
  }
}

export const initGiftCardModel = (sequelize: Sequelize) => {
  GiftCard.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      code: { type: DataTypes.STRING(24), allowNull: false },
      amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      purchaserId: { type: DataTypes.UUID, allowNull: false },
      recipientEmail: { type: DataTypes.STRING(255), allowNull: false },
      recipientName: { type: DataTypes.STRING(255), allowNull: true },
      message: { type: DataTypes.TEXT, allowNull: true },
      redeemedByUserId: { type: DataTypes.UUID, allowNull: true },
      redeemedAt: { type: DataTypes.DATE, allowNull: true },
      expiresAt: { type: DataTypes.DATE, allowNull: false },
      status: {
        type: DataTypes.ENUM('PENDING', 'ACTIVE', 'REDEEMED', 'EXPIRED', 'CANCELLED', 'FAILED'),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      razorpayOrderId: { type: DataTypes.STRING(64), allowNull: true },
      razorpayPaymentId: { type: DataTypes.STRING(64), allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'gift_cards', timestamps: true, paranoid: true },
  );
  return GiftCard;
};
