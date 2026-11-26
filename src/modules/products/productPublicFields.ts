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

export function stripInternalProductFields<T extends object>(product: T): T {
  const copy = { ...product } as Record<string, unknown>;
  for (const field of INTERNAL_PRODUCT_FIELDS) delete copy[field];
  return copy as T;
}

/** The shopper's view of a product; the team's own views (`customerFacing` false) keep everything. */
export function forViewer<T extends object>(product: T, customerFacing?: boolean): T {
  return customerFacing ? stripInternalProductFields(product) : product;
}
