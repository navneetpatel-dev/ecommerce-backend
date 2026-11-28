import { z } from 'zod';
import { COUPON_USER_SEGMENT_VALUES } from '@core/constants/statuses';

export const COUPON_TYPES = [
  'PERCENTAGE',
  'FLAT',
  'FREE_SHIPPING',
  'BOGO',
  'TIERED',
  'CASHBACK',
  'BUNDLE',
] as const;

const TYPES_REQUIRING_VALUE = new Set<(typeof COUPON_TYPES)[number]>([
  'PERCENTAGE',
  'FLAT',
  'CASHBACK',
  'BUNDLE',
]);

export type CouponShape = {
  type: (typeof COUPON_TYPES)[number];
  value?: number | null;
  startDate: string;
  endDate: string;
  config?: {
    tiers?: Array<{ minSubtotal: number; percent: number }>;
    bundleProductIds?: string[];
  } | null;
  userRestriction?: { type: string; value?: string | string[] } | null;
};

/** The rules a whole coupon must satisfy, used on create and on an edit's merged result. */
export function refineCouponShape(
  data: CouponShape,
  ctx: z.RefinementCtx,
  opts: { endMustBeFuture?: boolean } = { endMustBeFuture: true },
) {
  if (TYPES_REQUIRING_VALUE.has(data.type) && (data.value == null || Number.isNaN(data.value))) {
    ctx.addIssue({
      code: 'custom',
      path: ['value'],
      message: 'Value is required for this coupon type',
    });
  }

  if (TYPES_REQUIRING_VALUE.has(data.type) && data.value != null && data.value <= 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['value'],
      message: 'Value must be greater than zero',
    });
  }

  if ((data.type === 'PERCENTAGE' || data.type === 'TIERED') && data.value != null && data.value > 100) {
    ctx.addIssue({
      code: 'custom',
      path: ['value'],
      message: 'Percentage value cannot exceed 100',
    });
  }

  if (data.type === 'TIERED') {
    const tiers = data.config?.tiers ?? [];
    const hasValue = data.value != null && !Number.isNaN(data.value) && data.value > 0;
    if (tiers.length === 0 && !hasValue) {
      ctx.addIssue({
        code: 'custom',
        path: ['config'],
        message: 'Tiered coupons require tiers or a percentage value',
      });
    }
    const ascending = tiers.every(
      (tier, index) => index === 0 || tier.minSubtotal > tiers[index - 1]!.minSubtotal,
    );
    if (!ascending) {
      ctx.addIssue({
        code: 'custom',
        path: ['config', 'tiers'],
        message: 'Each tier must start above the one before it',
      });
    }
  }

  if (data.type === 'BUNDLE') {
    const ids = data.config?.bundleProductIds ?? [];
    if (ids.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['config', 'bundleProductIds'],
        message: 'Bundle coupons require at least one product',
      });
    }
  }

  const start = Date.parse(data.startDate);
  const end = Date.parse(data.endDate);
  if (!Number.isNaN(start) && !Number.isNaN(end) && end <= start) {
    ctx.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'End date must be after start date',
    });
  }
  if (opts.endMustBeFuture && !Number.isNaN(end) && end <= Date.now()) {
    ctx.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'End date must be in the future',
    });
  }

  const restriction = data.userRestriction;
  const restrictionType = restriction?.type?.toLowerCase();
  const restrictionValues = Array.isArray(restriction?.value)
    ? restriction.value
    : restriction?.value
      ? [restriction.value]
      : [];
  if (restrictionType === 'specific') {
    const validIds = restrictionValues.length > 0
      && restrictionValues.every((id) => z.string().uuid().safeParse(id).success);
    if (!validIds) {
      ctx.addIssue({
        code: 'custom',
        path: ['userRestriction', 'value'],
        message: 'Choose at least one customer',
      });
    }
  }
  if (restrictionType === 'segment') {
    const validSegments = restrictionValues.length > 0
      && restrictionValues.every((segment) =>
        (COUPON_USER_SEGMENT_VALUES as readonly string[]).includes(segment.toLowerCase()),
      );
    if (!validSegments) {
      ctx.addIssue({
        code: 'custom',
        path: ['userRestriction', 'value'],
        message: 'Choose a customer segment',
      });
    }
  }
}

