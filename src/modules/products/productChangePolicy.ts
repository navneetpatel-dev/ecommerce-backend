import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ValidationError } from '@core/errors/ValidationError';
import { PRODUCT_STATUS } from '@core/constants/statuses';
import { ERROR_MESSAGES } from '@core/constants/errors';

/** Who is changing a product, in the terms the policy needs. Built once per request in the controller. */
export type ProductActor = {
  id: string;
  /** The actor's own store; null for the platform. */
  vendorId: string | null;
  /** Platform product admin (`product.manage`, or Super Admin). */
  canManage: boolean;
  /** `product.pricing`, or Super Admin. */
  canPrice: boolean;
};

export type ProductFacts = {
  vendorId: string | null;
  status: string;
  listedByPlatform?: boolean | null;
};

export const CHANGE_REASON_MIN = 10;
export const CHANGE_REASON_MAX = 500;

/** The actor is the product's own vendor. */
export function actsInOwnStore(actor: ProductActor, product: ProductFacts): boolean {
  return actor.vendorId != null && actor.vendorId === product.vendorId;
}

/**
 * A platform admin acting on a vendor's product. These are the actions that are audited "on behalf of
 * the vendor" and that the vendor is told about.
 */
export function isOnBehalf(actor: ProductActor, product: ProductFacts): boolean {
  return !actsInOwnStore(actor, product) && actor.canManage && product.vendorId != null;
}

/** A product the platform listed that no customer can see yet (it can be priced while it is prepared). */
export function isUnpublishedPlatformListing(product: ProductFacts): boolean {
  return (
    Boolean(product.listedByPlatform) &&
    (product.status === PRODUCT_STATUS.DRAFT || product.status === PRODUCT_STATUS.REJECTED)
  );
}

export type PricingDecision =
  | { allowed: true; requiresReason: boolean }
  | { allowed: false; reason: 'PRICING_RESTRICTED' };

/**
 * May this actor change what the product costs or how it is taxed and paid for (price, MRP, HSN code,
 * COD, a variant's price, adding a variant)?
 *  - The vendor, on their own products: yes.
 *  - A platform admin: freely on a platform-listed product that is still unpublished; otherwise only
 *    with `product.pricing`, and then a written reason is required.
 */
export function decidePricingChange(actor: ProductActor, product: ProductFacts): PricingDecision {
  if (actsInOwnStore(actor, product)) return { allowed: true, requiresReason: false };
  if (!actor.canManage) return { allowed: false, reason: 'PRICING_RESTRICTED' };
  // The platform's own products (no vendor) are its catalog to price; the restriction protects a vendor's pricing.
  if (product.vendorId == null || isUnpublishedPlatformListing(product)) return { allowed: true, requiresReason: false };
  return actor.canPrice ? { allowed: true, requiresReason: true } : { allowed: false, reason: 'PRICING_RESTRICTED' };
}

export function isValidReason(reason: unknown): reason is string {
  const text = typeof reason === 'string' ? reason.trim() : '';
  return text.length >= CHANGE_REASON_MIN && text.length <= CHANGE_REASON_MAX;
}

/** Throws unless the actor may make this pricing change; returns the trimmed reason when one is required. */
export function assertPricingChangeAllowed(
  actor: ProductActor,
  product: ProductFacts,
  changeReason: unknown,
): string | null {
  const decision = decidePricingChange(actor, product);
  if (!decision.allowed) {
    throw new ForbiddenError(ERROR_MESSAGES.PRODUCT_PRICING_RESTRICTED);
  }
  if (decision.requiresReason && !isValidReason(changeReason)) {
    throw new ValidationError(ERROR_MESSAGES.PRODUCT_CHANGE_REASON_REQUIRED);
  }
  return isValidReason(changeReason) ? changeReason.trim() : null;
}
