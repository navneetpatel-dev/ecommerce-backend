import { toPublicCategory } from '@modules/categories/categoryPublic';

/**
 * What a team view (the owning vendor, a catalog admin) shows of the seller. An allowlist: the
 * vendor row also holds bank details, which no product response may carry.
 */
export const TEAM_VENDOR_ATTRIBUTES = [
  'id', 'businessName', 'slug', 'logoUrl', 'status', 'kycVerified', 'commissionRate', 'performanceScore',
  'returnShippingFee', 'codEnabled', 'gstNumber', 'state', 'entityType', 'payoutFrequency',
];

/**
 * Columns that are for the team, never for shoppers: who created or changed a product, who approved it,
 * the moderator's note, and how it was listed.
 */
const INTERNAL_PRODUCT_FIELDS = [
  'createdBy',
  'updatedBy',
  'deletedBy',
  'approvedById',
  'rejectionNote',
  'listedByPlatform',
  'vendorConsentNote',
] as const;

/**
 * The shopper's view of a product: none of the team's fields, and neither the seller's nor the
 * category's commission (or who created and changed the category).
 */
export function toShopperProduct<T extends object>(product: T): T {
  const copy = { ...product } as Record<string, unknown>;
  for (const field of INTERNAL_PRODUCT_FIELDS) delete copy[field];
  for (const key of ['category', 'Category']) {
    if (isRecord(copy[key])) copy[key] = toPublicCategory(copy[key] as Record<string, unknown>);
  }
  if (isRecord(copy.vendor)) {
    const { commissionRate: _commissionRate, ...vendor } = copy.vendor as Record<string, unknown>;
    copy.vendor = vendor;
  }
  return copy as T;
}

const isRecord = (value: unknown): boolean => typeof value === 'object' && value !== null;

/** The shopper's view of a product; the team's own views (`customerFacing` false) keep everything. */
export function forViewer<T extends object>(product: T, customerFacing?: boolean): T {
  return customerFacing ? toShopperProduct(product) : product;
}
