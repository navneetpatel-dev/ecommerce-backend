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
import { NotFoundError } from '@core/errors/NotFoundError';
import {
  cascadeDeleteEntityMedia,
  deleteS3ObjectIfReplaced,
  S3_ENTITY_TYPES,
} from '@core/s3';
import type { CreatePromoBannerRequest, UpdatePromoBannerRequest } from './homepage.dto';

type SerializedPromoBanner = {
  id: string;
  title: string;
  imageUrl: string;
  linkType: PromoBanner['linkType'];
  linkTargetId: string | null;
  linkUrl: string | null;
  linkSlug: string | null;
  startDate: Date | null;
  endDate: Date | null;
  status: PromoBanner['status'];
  priority: number;
  createdAt: Date;
  updatedAt: Date;
};

function serializeBanner(
  banner: PromoBanner,
  extras?: { linkSlug?: string | null },
): SerializedPromoBanner {
  const plain = banner.get({ plain: true });
  return {
    id: plain.id,
    title: plain.title,
    imageUrl: plain.imageUrl,
    linkType: plain.linkType,
    linkTargetId: plain.linkTargetId,
    linkUrl: plain.linkUrl,
    linkSlug: extras?.linkSlug ?? null,
    startDate: plain.startDate,
    endDate: plain.endDate,
    status: plain.status,
    priority: plain.priority,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
}

async function resolveLinkSlug(
  linkType: string,
  linkTargetId: string | null,
): Promise<string | null> {
  if (!linkTargetId) return null;

  if (linkType === PROMO_BANNER_LINK_TYPE.PRODUCT) {
    const product = await Product.scope('customerVisible').findByPk(linkTargetId, {
      attributes: ['slug'],
    });
    return product?.slug ?? null;
  }

  if (linkType === PROMO_BANNER_LINK_TYPE.VENDOR) {
    const vendor = await Vendor.findOne({
      where: { id: linkTargetId, status: VENDOR_STATUS.APPROVED },
      attributes: ['slug'],
    });
    return vendor?.slug ?? null;
  }

  if (linkType === PROMO_BANNER_LINK_TYPE.CATEGORY) {
    const category = await Category.findOne({
      where: { id: linkTargetId, status: CATEGORY_STATUS.ACTIVE },
      attributes: ['slug'],
    });
    return category?.slug ?? null;
  }

  return null;
}

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

  const visible: SerializedPromoBanner[] = [];
  for (const banner of banners) {
    if (banner.linkType === PROMO_BANNER_LINK_TYPE.URL) {
      visible.push(serializeBanner(banner));
      continue;
    }
    if (await isLinkTargetVisible(banner.linkType, banner.linkTargetId)) {
      const linkSlug = await resolveLinkSlug(banner.linkType, banner.linkTargetId);
      visible.push(serializeBanner(banner, { linkSlug }));
    }
  }
  return visible;
}

export async function listBanners() {
  const banners = await PromoBanner.findAll({
    order: [['priority', 'DESC'], ['createdAt', 'DESC']],
  });
  return banners.map((banner) => serializeBanner(banner));
}

export async function getBannerById(id: string) {
  const banner = await PromoBanner.findByPk(id);
  if (!banner) throw new NotFoundError('PromoBanner');
  return serializeBanner(banner);
}

export async function createBanner(data: CreatePromoBannerRequest) {
  const banner = await PromoBanner.create({
    title: data.title,
    imageUrl: data.imageUrl,
    linkType: data.linkType,
    linkTargetId: data.linkType === PROMO_BANNER_LINK_TYPE.URL ? null : (data.linkTargetId ?? null),
    linkUrl: data.linkType === PROMO_BANNER_LINK_TYPE.URL ? (data.linkUrl ?? null) : null,
    startDate: data.startDate ?? null,
    endDate: data.endDate ?? null,
    status: data.status ?? PROMO_BANNER_STATUS.DRAFT,
    priority: data.priority ?? 0,
  } as any);
  return serializeBanner(banner);
}

export async function updateBanner(id: string, data: UpdatePromoBannerRequest) {
  const banner = await PromoBanner.findByPk(id);
  if (!banner) throw new NotFoundError('PromoBanner');

  const previousImageUrl = banner.imageUrl;
  const nextLinkType = data.linkType ?? banner.linkType;

  await banner.update({
    ...(data.title !== undefined ? { title: data.title } : {}),
    ...(data.imageUrl !== undefined ? { imageUrl: data.imageUrl } : {}),
    ...(data.linkType !== undefined ? { linkType: data.linkType } : {}),
    ...(data.linkTargetId !== undefined || data.linkType !== undefined
      ? {
          linkTargetId:
            nextLinkType === PROMO_BANNER_LINK_TYPE.URL
              ? null
              : (data.linkTargetId !== undefined ? data.linkTargetId : banner.linkTargetId),
        }
      : {}),
    ...(data.linkUrl !== undefined || data.linkType !== undefined
      ? {
          linkUrl:
            nextLinkType === PROMO_BANNER_LINK_TYPE.URL
              ? (data.linkUrl !== undefined ? data.linkUrl : banner.linkUrl)
              : null,
        }
      : {}),
    ...(data.startDate !== undefined ? { startDate: data.startDate } : {}),
    ...(data.endDate !== undefined ? { endDate: data.endDate } : {}),
    ...(data.status !== undefined ? { status: data.status } : {}),
    ...(data.priority !== undefined ? { priority: data.priority } : {}),
  } as any);

  if (data.imageUrl !== undefined) {
    await deleteS3ObjectIfReplaced(previousImageUrl, data.imageUrl);
  }

  await banner.reload();
  return serializeBanner(banner);
}

export async function deleteBanner(id: string) {
  const banner = await PromoBanner.findByPk(id);
  if (!banner) throw new NotFoundError('PromoBanner');
  const imageUrl = banner.imageUrl;
  await banner.destroy();
  await cascadeDeleteEntityMedia(S3_ENTITY_TYPES.BANNERS, id, [imageUrl]);
}
