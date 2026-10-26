import { Op, type Transaction } from 'sequelize';
import { ValidationError } from '@core/errors';
import { Order } from '@database/models/order.model';
import { Shipment } from '@database/models/shipment.model';
import { codAmountForSubOrder } from '@modules/shipping/codCollection';
import { shippingService } from '@modules/shipping/shipping.service';

/**
 * Records a part's dispatch: its shipment (created, or re-dispatched with a corrected
 * tracking number), with the cash still owed at the door for a COD order.
 */
export async function recordPartShipment(
  id: string,
  orderId: string,
  trackingId: string,
  transaction: Transaction,
): Promise<void> {
  const parentOrder = await Order.findByPk(orderId, {
    transaction,
    attributes: [
      'id',
      'paymentMethod',
      'walletAmountUsed',
      'giftWrapFeeAmount',
      'originalTotalAmount',
      'totalAmount',
      'razorpayAmountPaid',
      'razorpayPaymentId',
    ],
  });
  // What is still owed at the door for this shipment: its share of the order, less
  // the wallet already applied, plus the gift-wrap fee on the first shipment.
  const codAmount =
    parentOrder?.paymentMethod === 'COD'
      ? await codAmountForSubOrder(parentOrder, id, transaction)
      : null;
  // A tracking number names one parcel: carrier updates and the customer's tracking
  // find the shipment by it alone.
  const taken = await Shipment.findOne({
    where: { trackingNumber: trackingId, subOrderId: { [Op.ne]: id } },
    attributes: ['id'],
    transaction,
  });
  if (taken) {
    throw new ValidationError({ trackingId: ['This tracking number is already used by another shipment'] });
  }
  const [shipment, created] = await Shipment.findOrCreate({
    where: { subOrderId: id },
    defaults: {
      subOrderId: id,
      carrier: 'MANUAL',
      trackingNumber: trackingId,
      status: 'IN_TRANSIT',
      shippedAt: new Date(),
      codAmount,
    } as never,
    transaction,
  });
  if (!created) {
    await shippingService.applyShipmentStatus(
      shipment,
      'IN_TRANSIT',
      { trackingNumber: trackingId, carrier: shipment.carrier ?? 'MANUAL' },
      transaction,
    );
  }
}
