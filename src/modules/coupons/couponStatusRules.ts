import { COUPON_STATUS, type CouponStatus } from '@core/constants/statuses';

const {
  DRAFT,
  PENDING_APPROVAL,
  ACTIVE,
  PAUSED,
  EXPIRED,
  ARCHIVED,
  REJECTED,
} = COUPON_STATUS;

/** Where a vendor owner may move their own coupon. A rejected one is resubmitted by editing it. */
const VENDOR_TRANSITIONS: Record<CouponStatus, readonly CouponStatus[]> = {
  [DRAFT]: [PENDING_APPROVAL, ARCHIVED],
  [PENDING_APPROVAL]: [ARCHIVED],
  [ACTIVE]: [PAUSED, ARCHIVED],
  [PAUSED]: [ACTIVE, ARCHIVED],
  [REJECTED]: [ARCHIVED],
  [EXPIRED]: [ARCHIVED],
  [ARCHIVED]: [],
};

const ADMIN_TRANSITIONS: Record<CouponStatus, readonly CouponStatus[]> = {
  [DRAFT]: [ACTIVE, ARCHIVED],
  [PENDING_APPROVAL]: [ACTIVE, REJECTED, ARCHIVED],
  [ACTIVE]: [PAUSED, REJECTED, ARCHIVED],
  [PAUSED]: [ACTIVE, REJECTED, ARCHIVED],
  [REJECTED]: [ACTIVE, ARCHIVED],
  [EXPIRED]: [ARCHIVED],
  [ARCHIVED]: [],
};

export function canMoveCouponStatus(
  from: CouponStatus,
  to: CouponStatus,
  actor: 'vendor' | 'admin',
): boolean {
  const table = actor === 'vendor' ? VENDOR_TRANSITIONS : ADMIN_TRANSITIONS;
  return table[from]?.includes(to) ?? false;
}

/** Fields whose change alters what a vendor coupon gives away, so it needs approving again. */
export const COUPON_FIELDS_NEEDING_REAPPROVAL = [
  'type',
  'value',
  'maxDiscountCap',
  'applicableScope',
  'userRestriction',
  'excludedItems',
  'config',
] as const;
