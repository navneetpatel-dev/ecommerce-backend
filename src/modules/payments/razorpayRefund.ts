import { razorpay } from '@config/razorpay';

type RefundNotes = Record<string, string>;

/** Whether an existing refund is the one these notes and this amount describe. */
function isSameRefund(
  existing: { amount?: number | string; status?: string; notes?: unknown },
  amountPaise: number,
  notes: RefundNotes,
): boolean {
  if (existing.status === 'failed') return false;
  if (Number(existing.amount) !== amountPaise) return false;
  const existingNotes = (existing.notes ?? {}) as Record<string, unknown>;
  return Object.entries(notes).every(([key, value]) => existingNotes[key] === value);
}

/**
 * Refunds a payment at most once per purpose. The notes name what the refund is for (a
 * return, a cancelled part, an order cancel, a recharge), so a refund already on the
 * payment with the same notes and amount is that refund: a call that timed out after
 * Razorpay processed it, then retried, adopts it instead of refunding the customer twice.
 * Razorpay's refund API takes no idempotency key, so this lookup is the guard.
 */
export async function createIdempotentRazorpayRefund(
  paymentId: string,
  amountPaise: number,
  notes: RefundNotes,
): Promise<string> {
  const existing = await razorpay.payments.fetchMultipleRefund(paymentId, { count: 100 });
  const match = (existing.items ?? []).find((refund) =>
    isSameRefund(refund as Parameters<typeof isSameRefund>[0], amountPaise, notes),
  );
  if (match) return String(match.id);
  const refund = await razorpay.payments.refund(paymentId, { amount: amountPaise, notes });
  return String(refund.id);
}
