import { settingsService } from '@modules/settings/settings.service';
import { roundMoney } from '@modules/pricing/money';

/** TTL from settings; null when expiry is disabled. */
export async function promotionalCreditExpiryDate(): Promise<Date | null> {
  const settings = await settingsService.getPlatformSettings();
  const ttlDays = Number(settings.promotionalPointsTtlDays ?? 0);
  if (ttlDays <= 0) return null;
  const expires = new Date();
  expires.setDate(expires.getDate() + ttlDays);
  return expires;
}

/**
 * Promotional points to expire now: what is still unused of the lots past their expiry.
 * Promotional points are used first-to-expire first (spending, clawbacks and earlier
 * expiry runs all draw on the oldest lots), so the part of the expired lots still unused
 * is the expired lots less everything promotional already used — never more than the
 * promotional balance. Counting all expired lots on every run (as it did) expired, on
 * the next run, lots that had already expired or been spent, and so took newer points
 * still within their validity.
 */
export function promotionalExpiryDebitAmount(input: {
  /** Promotional credits whose expiry has passed, all time. */
  expiredLots: number;
  /** All promotional credits, all time. */
  promotionalCredits: number;
  /** Promotional balance now. */
  netPromotional: number;
}): number {
  const netPromotional = Math.max(0, input.netPromotional);
  const used = Math.max(0, input.promotionalCredits - netPromotional);
  const unusedExpired = Math.max(0, input.expiredLots - used);
  return roundMoney(Math.min(unusedExpired, netPromotional));
}
