import { PRODUCT_STATUS } from '@core/constants/statuses';
import { logAudit } from '@modules/audit/audit.service';
import { notifyAdminsOfVendorEdit } from '@modules/notifications/events/catalogEvents';
import { actsInOwnStore, type ProductActor, type ProductFacts } from './productChangePolicy';

/** What shoppers read and see; a change to a listing that is on sale is published without review. */
const SHOWN_TO_SHOPPERS = ['name', 'description', 'images', 'primary image'];

type Edited = ProductFacts & { id: string; name: string; description?: string | null };

/**
 * A vendor's edit of a live listing goes out at once, so it is recorded (with the old and new text)
 * and the people who approve products are told to take a look. Never blocks the edit.
 */
export async function recordVendorLiveEdit(
  actor: ProductActor,
  product: Edited,
  changedFields: string[],
  update: { name?: string; description?: string | null } = {},
): Promise<void> {
  if (!actsInOwnStore(actor, product) || product.status !== PRODUCT_STATUS.LIVE) return;
  const shown = changedFields.filter((field) => SHOWN_TO_SHOPPERS.includes(field));
  if (!shown.length) return;
  const text = (['name', 'description'] as const).filter((field) => shown.includes(field));
  await logAudit({
    actorId: actor.id,
    action: 'PRODUCT_LIVE_EDITED_BY_VENDOR',
    entityType: 'Product',
    entityId: product.id,
    metadata: {
      vendorId: product.vendorId,
      name: update.name ?? product.name,
      changedFields: shown,
      ...(text.length && {
        before: Object.fromEntries(text.map((field) => [field, product[field] ?? null])),
        after: Object.fromEntries(text.map((field) => [field, update[field] ?? null])),
      }),
    },
  });
  void notifyAdminsOfVendorEdit({
    productId: product.id,
    productName: update.name ?? product.name,
    vendorId: product.vendorId!,
    changes: shown.join(', '),
  });
}
