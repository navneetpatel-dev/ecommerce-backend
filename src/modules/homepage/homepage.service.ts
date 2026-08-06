import { Op } from 'sequelize';
import { PromoBanner } from '@database/models/promoBanner.model';
import { Category } from '@database/models/category.model';
import { Product } from '@database/models/product.model';
import { Vendor } from '@database/models/vendor.model';
import {
  CATEGORY_STATUS,
  PROMO_BANNER_LINK_TYPE,
  PROMO_BANNER_STATUS,
  VENDOR_STATUS,
} from '@core/constants/statuses';

async function isLinkTargetVisible(
  linkType: string,
  linkTargetId: string | null,
): Promise<boolean> {
  if (!linkTargetId) return false;

  if (linkType === PROMO_BANNER_LINK_TYPE.PRODUCT) {
    const product = await Product.scope('customerVisible').findByPk(linkTargetId, {
      attributes: ['id'],
    });
    return Boolean(product);
  }

  if (linkType === PROMO_BANNER_LINK_TYPE.VENDOR) {
    const vendor = await Vendor.findOne({
      where: { id: linkTargetId, status: VENDOR_STATUS.APPROVED },
      attributes: ['id'],
    });
    return Boolean(vendor);
  }

  if (linkType === PROMO_BANNER_LINK_TYPE.CATEGORY) {
    const category = await Category.findOne({
      where: { id: linkTargetId, status: CATEGORY_STATUS.ACTIVE },
      attributes: ['id'],
    });
    return Boolean(category);
  }

  return false;
}

export async function getActiveBanners() {
  const now = new Date();
  const banners = await PromoBanner.findAll({
    where: {
      status: PROMO_BANNER_STATUS.ACTIVE,
      [Op.and]: [
        { [Op.or]: [{ startDate: null }, { startDate: { [Op.lte]: now } }] },
        { [Op.or]: [{ endDate: null }, { endDate: { [Op.gte]: now } }] },
      ],
    },
    order: [['priority', 'DESC'], ['createdAt', 'DESC']],
  });

  const visible: PromoBanner[] = [];
  for (const banner of banners) {
    if (banner.linkType === PROMO_BANNER_LINK_TYPE.URL) {
      visible.push(banner);
      continue;
    }
    if (await isLinkTargetVisible(banner.linkType, banner.linkTargetId)) {
      visible.push(banner);
    }
  }
  return visible;
}
