import { z } from 'zod';
import {
  PROMO_BANNER_LINK_TYPE,
  PROMO_BANNER_LINK_TYPE_VALUES,
  PROMO_BANNER_STATUS_VALUES,
} from '@core/constants/statuses';

const optionalUuid = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().uuid().nullable().optional(),
);

const optionalUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().url().nullable().optional(),
);

const optionalDate = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.coerce.date().nullable().optional(),
);

export const CreatePromoBannerSchema = z
  .object({
    title: z.string().min(1).max(200),
    imageUrl: z.string().url(),
    linkType: z.enum(PROMO_BANNER_LINK_TYPE_VALUES),
    linkTargetId: optionalUuid,
    linkUrl: optionalUrl,
    startDate: optionalDate,
    endDate: optionalDate,
    status: z.enum(PROMO_BANNER_STATUS_VALUES).optional(),
    priority: z.coerce.number().int().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.linkType === PROMO_BANNER_LINK_TYPE.URL) {
      if (!data.linkUrl) {
        ctx.addIssue({ code: 'custom', path: ['linkUrl'], message: 'linkUrl is required for URL banners' });
      }
    } else if (!data.linkTargetId) {
      ctx.addIssue({
        code: 'custom',
        path: ['linkTargetId'],
        message: 'linkTargetId is required for PRODUCT/CATEGORY/VENDOR banners',
      });
    }
  });

export const UpdatePromoBannerSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    imageUrl: z.string().url().optional(),
    linkType: z.enum(PROMO_BANNER_LINK_TYPE_VALUES).optional(),
    linkTargetId: optionalUuid,
    linkUrl: optionalUrl,
    startDate: optionalDate,
    endDate: optionalDate,
    status: z.enum(PROMO_BANNER_STATUS_VALUES).optional(),
    priority: z.coerce.number().int().optional(),
  })
  .superRefine((data, ctx) => {
    const linkType = data.linkType;
    if (!linkType) return;
    if (linkType === PROMO_BANNER_LINK_TYPE.URL) {
      if (data.linkUrl === null || data.linkUrl === undefined) {
        ctx.addIssue({ code: 'custom', path: ['linkUrl'], message: 'linkUrl is required for URL banners' });
      }
    } else if (data.linkTargetId === null || data.linkTargetId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['linkTargetId'],
        message: 'linkTargetId is required for PRODUCT/CATEGORY/VENDOR banners',
      });
    }
  });

export type CreatePromoBannerRequest = z.infer<typeof CreatePromoBannerSchema>;
export type UpdatePromoBannerRequest = z.infer<typeof UpdatePromoBannerSchema>;
