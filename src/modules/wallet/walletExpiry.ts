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

/** Debit at most remaining promotional points for expired lots. */
export function promotionalExpiryDebitAmount(expiredLots: number, netPromo: number): number {
  return roundMoney(Math.min(Math.max(0, expiredLots), Math.max(0, netPromo)));
}
