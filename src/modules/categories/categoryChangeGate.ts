import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { User } from '@database/models/user.model';
import { logAudit } from '@modules/audit/audit.service';
import { notificationsService } from '@modules/notifications/notifications.service';
import { isValidReason } from '@modules/products/productChangePolicy';
import type { CategoryRateImpact } from './categoryRateImpact';

export type CategoryChangeActor = { id: string; /** `product.pricing`, or Super Admin. */ canPrice: boolean };

/**
 * Moving products or categories may not quietly change what vendors are charged: when GST or
 * commission would change on live or pending products, it takes the pricing power and a written
 * reason, exactly as a price change does. Returns the reason to record, or null when none is needed.
 */
export function assertRateChangeAllowed(
  actor: CategoryChangeActor,
  impact: Pick<CategoryRateImpact, 'productCount'>,
  changeReason: unknown,
): string | null {
  if (impact.productCount === 0) return null;
  if (!actor.canPrice) throw new ForbiddenError(ERROR_MESSAGES.CATEGORY_RATE_CHANGE_RESTRICTED);
  if (!isValidReason(changeReason)) {
    throw new ValidationError({ changeReason: [ERROR_MESSAGES.PRODUCT_CHANGE_REASON_REQUIRED] });
  }
  return changeReason.trim();
}

/** One audit row per affected vendor (the audit page filters by it), and an email to its users. */
export async function recordRateChange(
  actorId: string,
  categoryId: string,
  impact: CategoryRateImpact,
  reason: string,
  changes = 'GST rate or commission, because their category was moved',
) {
  for (const vendor of impact.vendors) {
    const audit = await logAudit({
      actorId,
      action: 'CATEGORY_RATE_CHANGED',
      entityType: 'Category',
      entityId: categoryId,
      metadata: { vendorId: vendor.vendorId, products: vendor.products, reason, onBehalfOfVendor: true },
    });
    const users = await User.findAll({ where: { vendorId: vendor.vendorId }, attributes: ['id'] });
    for (const user of users) {
      void notificationsService.sendProductUpdatedByPlatform(user.id, audit.id, {
        productName: `${vendor.products} of your products`,
        changes,
        reason: `Reason: ${reason}`,
      });
    }
  }
}
