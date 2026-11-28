import jwt from 'jsonwebtoken';
import { env } from '@config/env';
import { ValidationError } from '@core/errors/ValidationError';

const PURPOSE = 'stock-alert-cancel';
export const STOCK_ALERT_LINK_INVALID = 'This link is not valid.';

const clientBase = () => env.CLIENT_URL.replace(/\/$/, '');

export const productPageUrl = (slug: string) => `${clientBase()}/products/${slug}`;

/** A link-safe token naming one alert; it does not expire, as cancel links must keep working. */
export function stockAlertCancelUrl(alertId: string): string {
  const token = jwt.sign({ sub: alertId, purpose: PURPOSE }, env.JWT_SECRET);
  return `${clientBase()}/stock-alerts/cancel?token=${encodeURIComponent(token)}`;
}

/** The alert a cancel link names. */
export function alertIdFromToken(token: string): string {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as { sub?: string; purpose?: string };
    if (decoded.purpose !== PURPOSE || !decoded.sub) throw new Error('purpose');
    return decoded.sub;
  } catch {
    throw new ValidationError({ token: [STOCK_ALERT_LINK_INVALID] });
  }
}
