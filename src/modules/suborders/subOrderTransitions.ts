import { Op, type WhereOptions } from 'sequelize';
import { ValidationError } from '@core/errors';
import { ORDER_STATUS, PAYMENT_METHOD, PAYMENT_STATUS } from '@core/constants/statuses';

/**
 * Transitions reachable through this manual, vendor/admin-facing endpoint.
 * DELIVERED is deliberately absent from every entry — that transition is
 * only reachable through the delivery agent's OTP-gated confirmation
 * (`deliveryAgents.service.ts`'s `confirmDelivery`), never a plain status
 * PATCH, so an order can't be marked delivered without proof the customer
 * actually received it. RETURNED is likewise not settable here — the
 * returns module owns that lifecycle via `ReturnRequest.status`.
 */
export const SUBORDER_MANUAL_TRANSITIONS: Record<string, readonly string[]> = {
  [ORDER_STATUS.PENDING]: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.SHIPPED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.CONFIRMED]: [ORDER_STATUS.SHIPPED, ORDER_STATUS.CANCELLED],
};

/**
 * Statuses that may be re-submitted unchanged: a no-op, or for SHIPPED a tracking-id
 * correction. CANCELLED is never one — re-running it would restock and refund the part
 * a second time.
 */
const SUBORDER_RESUBMITTABLE: ReadonlySet<string> = new Set([
  ORDER_STATUS.PENDING,
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.SHIPPED,
]);

export function assertSubOrderTransition(from: string, to: string) {
  if (from === to && SUBORDER_RESUBMITTABLE.has(from)) return;
  if (!SUBORDER_MANUAL_TRANSITIONS[from]?.includes(to)) {
    throw new ValidationError({ status: [`Cannot move an order from ${from} to ${to} here`] });
  }
}

/**
 * A part of an online order still awaiting its payment belongs to the checkout, not the
 * vendor: it may yet be abandoned (the expiry job cancels the whole order) or paid in
 * full. Shipping it sent goods nobody paid for; cancelling it left the customer charged
 * the full amount when the payment then came through. COD orders are unpaid until
 * delivery by design and are not affected.
 */
export function assertPartPaidFor(order: { paymentMethod?: string | null; paymentStatus?: string | null } | null) {
  if (order?.paymentMethod === PAYMENT_METHOD.RAZORPAY && order.paymentStatus === PAYMENT_STATUS.PENDING) {
    throw new ValidationError({ status: ['This order is still awaiting payment'] });
  }
}

/** Orders whose parts a vendor works on: COD, or online orders no longer awaiting payment. */
export const VENDOR_VISIBLE_ORDER_WHERE: WhereOptions = {
  [Op.or]: [
    { paymentMethod: PAYMENT_METHOD.COD },
    { paymentStatus: { [Op.ne]: PAYMENT_STATUS.PENDING } },
  ],
};

/** VENDOR_VISIBLE_ORDER_WHERE as SQL, for raw queries with the order aliased `o`. */
export const VENDOR_VISIBLE_ORDER_SQL = `(o."paymentMethod" = '${PAYMENT_METHOD.COD}' OR o."paymentStatus" <> '${PAYMENT_STATUS.PENDING}')`;
