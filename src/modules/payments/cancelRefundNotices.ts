import { Order } from '@database/models/order.model';
import { logger } from '@core/logger';
import { notificationsService } from '@modules/notifications/notifications.service';

/** Refund notes reasons that pay a cancelled order (or one cancelled part) back to the card. */
const CANCEL_REASONS = new Set(['ORDER_CANCEL', 'SUBORDER_CANCEL']);

export function isCancelRefund(notes: Record<string, string> | null | undefined): boolean {
  return Boolean(notes && CANCEL_REASONS.has(String(notes.reason)) && notes.orderId);
}

/**
 * Tells the shopper about a card refund for a cancelled order or part (B-68). Returns
 * already email "refund initiated" and "refund processed"; cancellations only sent
 * "Order cancelled", with no amount or refund at all. One email per stage per order or
 * part: the notification log de-duplicates on the reference, so a retried refund or a
 * repeated webhook does not email twice.
 */
export async function notifyCancelRefund(
  stage: 'started' | 'processed',
  notes: Record<string, string>,
  amountPaise: number,
): Promise<void> {
  if (!isCancelRefund(notes)) return;
  try {
    const order = await Order.findByPk(notes.orderId, { attributes: ['id', 'userId'] });
    if (!order?.userId) return;
    const forPart = notes.reason === 'SUBORDER_CANCEL' && notes.subOrderId;
    const referenceType = forPart ? 'SubOrderCancelRefund' : 'OrderCancelRefund';
    const referenceId = forPart ? notes.subOrderId! : order.id;
    const templateData = {
      orderId: order.id,
      orderNumber: order.id.slice(0, 8).toUpperCase(),
      amount: Number(amountPaise) / 100,
    };
    if (stage === 'started') {
      await notificationsService.sendRefundInitiated(order.userId, referenceId, templateData, referenceType);
    } else {
      await notificationsService.sendRefundProcessed(order.userId, referenceId, templateData, referenceType);
    }
  } catch (error) {
    logger.warn('Cancel refund email not sent', { notes, stage, reason: error instanceof Error ? error.message : String(error) });
  }
}
