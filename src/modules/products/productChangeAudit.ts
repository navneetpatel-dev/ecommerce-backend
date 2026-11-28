import { logAudit } from '@modules/audit/audit.service';
import { User } from '@database/models/user.model';
import { notificationsService } from '@modules/notifications/notifications.service';

/** Audit actions for what the platform does to a vendor's listing. The approval rule reads this set. */
export const ON_BEHALF_ACTIONS = [
  'PRODUCT_CREATED_ON_BEHALF',
  'PRODUCT_UPDATED_ON_BEHALF',
  'PRODUCT_PRICING_CHANGED_ON_BEHALF',
  'PRODUCT_VARIANT_ADDED_ON_BEHALF',
  'PRODUCT_VARIANT_UPDATED_ON_BEHALF',
  'PRODUCT_IMAGE_CHANGED_ON_BEHALF',
  'PRODUCT_SUBMITTED_ON_BEHALF',
  'PRODUCT_VARIANT_DELETED_ON_BEHALF',
] as const;

/**
 * Also recorded and told to the vendor, but not "preparing the listing": a stock correction or a
 * deletion does not stop the same admin approving it later.
 */
export type OnBehalfAction =
  | (typeof ON_BEHALF_ACTIONS)[number]
  | 'PRODUCT_STOCK_UPDATED_ON_BEHALF'
  | 'PRODUCT_DELETED_ON_BEHALF';

const isNumeric = (value: unknown) => typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)));

/** Equal as the database would see it: DECIMALs come back as strings ("100.00"), the form sends 100. */
const same = (a: unknown, b: unknown) =>
  isNumeric(a) && isNumeric(b) ? Number(a) === Number(b) : JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The keys of `update` whose value differs from the stored product (a form re-sending unchanged fields is not a change). */
export function changedFieldNames(before: Record<string, unknown>, update: Record<string, unknown>): string[] {
  // `changeReason` and `expectedStock` describe the edit; they are not fields of the record.
  const meta = new Set(['changeReason', 'expectedStock']);
  return Object.keys(update).filter((key) => !meta.has(key) && update[key] !== undefined && !same(before[key], update[key]));
}

/** Old and new values of the given fields, for the audit trail of a pricing change. */
export function beforeAfter(before: Record<string, unknown>, update: Record<string, unknown>, fields: string[]) {
  return {
    before: Object.fromEntries(fields.map((field) => [field, before[field] ?? null])),
    after: Object.fromEntries(fields.map((field) => [field, update[field] ?? null])),
  };
}

type OnBehalfEntry = {
  actorId: string;
  action: OnBehalfAction;
  productId: string;
  vendorId: string;
  name: string;
  metadata?: Record<string, unknown>;
};

/** Writes the audit row. `vendorId` is always included: the audit page filters a vendor's history by it. */
export async function auditOnBehalf(entry: OnBehalfEntry) {
  return logAudit({
    actorId: entry.actorId,
    action: entry.action,
    entityType: 'Product',
    entityId: entry.productId,
    metadata: { ...entry.metadata, vendorId: entry.vendorId, name: entry.name, onBehalfOfVendor: true },
  });
}

/** Everyone who works for the vendor is told, never the admin who did it. */
async function notifyVendorUsers(vendorId: string, send: (userId: string) => Promise<unknown> | unknown) {
  try {
    const users = await User.findAll({ where: { vendorId }, attributes: ['id'] });
    await Promise.all(users.map((user) => send(user.id)));
  } catch {
    // A notification failure must never undo a change that already succeeded.
  }
}

export function notifyListed(vendorId: string, productId: string, productName: string) {
  return notifyVendorUsers(vendorId, (userId) => notificationsService.sendProductListedByPlatform(userId, productId, { productName }));
}

export function notifyUpdated(
  vendorId: string,
  changeId: string,
  details: { productName: string; changes: string; reason?: string | null },
) {
  return notifyVendorUsers(vendorId, (userId) =>
    notificationsService.sendProductUpdatedByPlatform(userId, changeId, {
      productName: details.productName,
      changes: details.changes,
      reason: details.reason ? `Reason: ${details.reason}` : '',
    }),
  );
}

export function notifySubmitted(vendorId: string, productId: string, productName: string, consentNote: string) {
  return notifyVendorUsers(vendorId, (userId) => notificationsService.sendProductSubmittedByPlatform(userId, productId, { productName, consentNote }));
}
