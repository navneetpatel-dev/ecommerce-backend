import type { Transaction } from 'sequelize';
import { PAYMENT_STATUS } from '@core/constants/statuses';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Shipment } from '@database/models/shipment.model';
import { isReversedPart } from '@modules/pricing/partReversal';

/**
 * Marks the order PAID once every part still owed has shipped and had its cash collected
 * at the door. A part that was cancelled or came back undelivered (RTO) owes nothing, so
 * it no longer holds the order unpaid. A part not shipped yet has no Shipment row and
 * still owes its cash: judging by shipments alone would mark the order PAID early, and a
 * later cancel of that part would then refund cash that was never paid.
 * Runs on delivery, on RTO and on a part's cancellation, whichever settles the order last.
 */
export async function settleCodPaymentIfComplete(subOrderId: string, transaction: Transaction) {
  const subOrder = await SubOrder.findByPk(subOrderId, { transaction });
  if (!subOrder) return;
  const order = await Order.findByPk(subOrder.orderId, { transaction });
  if (!order || order.paymentMethod !== 'COD' || order.paymentStatus === PAYMENT_STATUS.PAID) return;

  const parts = (await SubOrder.findAll({
    where: { orderId: order.id },
    attributes: ['id', 'status'],
    include: [{ model: Shipment, as: 'shipment', required: false }],
    transaction,
  })) as (SubOrder & { shipment?: Shipment | null })[];
  const owedParts = parts.filter(
    (p) =>
      !isReversedPart(p.status) &&
      p.shipment?.status !== 'RTO_INITIATED' &&
      p.shipment?.status !== 'RTO_DELIVERED',
  );
  const allCollected =
    owedParts.length > 0 &&
    owedParts.every((p) => p.shipment != null && (p.shipment.codAmount == null || p.shipment.codCollected));
  if (allCollected) {
    await order.update({ paymentStatus: PAYMENT_STATUS.PAID }, { transaction });
  }
}
