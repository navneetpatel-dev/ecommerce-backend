import crypto from 'crypto';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';

/**
 * The id a Razorpay webhook delivery is de-duplicated on. Razorpay sends it in the
 * x-razorpay-event-id header, not in the body, and a retry carries the same id and the
 * same body — so the body hash stands in when the header is missing.
 */
export function razorpayWebhookEventId(
  event: { id?: string; event?: string } | null,
  bodyString: string,
  suppliedEventId?: string,
): string {
  if (!event?.event) {
    throw new ValidationError(ERROR_MESSAGES.INVALID_WEBHOOK_PAYLOAD);
  }
  const eventId =
    suppliedEventId?.trim() || event.id || crypto.createHash('sha256').update(bodyString).digest('hex');
  if (eventId.length > 255) {
    throw new ValidationError(ERROR_MESSAGES.INVALID_WEBHOOK_PAYLOAD);
  }
  return eventId;
}
