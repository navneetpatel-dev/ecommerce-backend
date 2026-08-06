import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import {
  PROMO_BANNER_LINK_TYPE_VALUES,
  PROMO_BANNER_STATUS,
  PROMO_BANNER_STATUS_VALUES,
  type PromoBannerLinkType,
  type PromoBannerStatus,
} from '@core/constants/statuses';

export class PromoBanner extends Model<InferAttributes<PromoBanner>, InferCreationAttributes<PromoBanner>> {
  declare id: CreationOptional<string>;
  declare title: string;
  declare imageUrl: string;
  declare linkType: PromoBannerLinkType;
  declare linkTargetId: string | null;
  declare linkUrl: string | null;
  declare startDate: Date | null;
  declare endDate: Date | null;
  declare status: CreationOptional<PromoBannerStatus>;
  declare priority: CreationOptional<number>;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;
}

export const initPromoBannerModel = (sequelize: Sequelize) => {
  PromoBanner.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      title: { type: DataTypes.STRING, allowNull: false },
      imageUrl: { type: DataTypes.STRING, allowNull: false },
      linkType: { type: DataTypes.ENUM(...PROMO_BANNER_LINK_TYPE_VALUES), allowNull: false },
      linkTargetId: { type: DataTypes.UUID, allowNull: true },
      linkUrl: { type: DataTypes.STRING, allowNull: true },
      startDate: { type: DataTypes.DATE, allowNull: true },
      endDate: { type: DataTypes.DATE, allowNull: true },
      status: {
        type: DataTypes.ENUM(...PROMO_BANNER_STATUS_VALUES),
        allowNull: false,
        defaultValue: PROMO_BANNER_STATUS.DRAFT,
      },
      priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'promo_banners', timestamps: true, paranoid: true },
  );
  return PromoBanner;
};
