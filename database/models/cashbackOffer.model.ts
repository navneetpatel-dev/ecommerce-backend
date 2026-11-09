import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

/** Platform-funded cashback applied at checkout without a coupon code. */
export class CashbackOffer extends Model<InferAttributes<CashbackOffer>, InferCreationAttributes<CashbackOffer>> {
  declare id: CreationOptional<string>;
  declare name: string;
  declare percent: number;
  /** Cap per order in rupees; null means uncapped. */
  declare maxCashback: number | null;
  /** Qualifying merchandise (after coupons, GST included) must reach this. */
  declare minOrderValue: CreationOptional<number>;
  /** Empty: every category. Otherwise these categories and everything under them. */
  declare categoryIds: CreationOptional<string[]>;
  /** Empty: every payment method. */
  declare paymentMethods: CreationOptional<string[]>;
  declare startsAt: CreationOptional<Date>;
  declare endsAt: Date | null;
  declare isActive: CreationOptional<boolean>;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date | null>;
}

export const initCashbackOfferModel = (sequelize: Sequelize) => {
  CashbackOffer.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      name: { type: DataTypes.STRING(120), allowNull: false },
      percent: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
      maxCashback: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      minOrderValue: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      categoryIds: { type: DataTypes.ARRAY(DataTypes.UUID), allowNull: false, defaultValue: [] },
      paymentMethods: { type: DataTypes.ARRAY(DataTypes.STRING(20)), allowNull: false, defaultValue: [] },
      startsAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      endsAt: { type: DataTypes.DATE, allowNull: true },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'cashback_offers', timestamps: true, paranoid: true },
  );
  return CashbackOffer;
};
