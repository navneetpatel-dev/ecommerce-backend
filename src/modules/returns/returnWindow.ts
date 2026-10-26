import { resolveReturnWindowForCategory } from '@modules/products/pdpPolicy';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether a delivered item's category takes returns, and until when (null: no limit). */
export type ReturnWindow = { allowed: false } | { allowed: true; expiresAt: Date | null };

/**
 * The return window for an item, from its category and when its part was delivered.
 * The one rule both a return request and the order view's "can return" use.
 */
export async function returnWindowFor(
  categoryId: string | null | undefined,
  deliveredAt: Date | null | undefined,
): Promise<ReturnWindow> {
  const window = await resolveReturnWindowForCategory(categoryId);
  if (!window.returnsAllowed || window.returnWindowDays == null) return { allowed: false };
  return {
    allowed: true,
    expiresAt: deliveredAt ? new Date(deliveredAt.getTime() + window.returnWindowDays * DAY_MS) : null,
  };
}

export function isWithinReturnWindow(window: ReturnWindow, now: Date = new Date()): boolean {
  return window.allowed && (window.expiresAt == null || now.getTime() <= window.expiresAt.getTime());
}
