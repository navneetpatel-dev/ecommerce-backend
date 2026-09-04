import { DeliveryRating } from '@database/models/deliveryRating.model';
import { Shipment } from '@database/models/shipment.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Order } from '@database/models/order.model';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';

/** Optional, dismissible post-delivery rating — one per shipment, never blocks anything. */
export const deliveryRatingsService = {
  async submit(shipmentId: string, userId: string, rating: number, comment?: string) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new ValidationError({ rating: ['Rating must be an integer from 1 to 5'] });
    }
    const shipment = await Shipment.findByPk(shipmentId, {
      include: [{
        model: SubOrder,
        as: 'subOrder',
        include: [{ model: Order, as: 'order', attributes: ['userId'] }],
      }],
    });
    if (!shipment) throw new NotFoundError('Shipment');
    const ownerId = (shipment as Shipment & { subOrder?: SubOrder & { order?: Order } }).subOrder?.order
      ?.userId;
    if (ownerId !== userId) throw new ForbiddenError(ERROR_MESSAGES.NO_ACCESS_TO_ORDER);
    if (shipment.status !== 'DELIVERED') {
      throw new ValidationError({ status: ['Only a delivered shipment can be rated'] });
    }
    if (!shipment.deliveryAgentId) {
      throw new ValidationError({ shipmentId: ['Shipment has no assigned delivery agent'] });
    }

    // Idempotent: a resubmit returns the original rating rather than erroring —
    // this is an optional, dismissible prompt, not a form with edit semantics.
    const [row] = await DeliveryRating.findOrCreate({
      where: { shipmentId },
      defaults: {
        shipmentId,
        userId,
        deliveryAgentId: shipment.deliveryAgentId,
        rating,
        comment: comment ?? null,
      },
    });
    return row;
  },

  async forShipment(shipmentId: string) {
    return DeliveryRating.findOne({ where: { shipmentId } });
  },

  async averageForAgent(deliveryAgentId: string): Promise<{ average: number | null; count: number }> {
    const ratings = await DeliveryRating.findAll({
      where: { deliveryAgentId },
      attributes: ['rating'],
    });
    if (!ratings.length) return { average: null, count: 0 };
    const sum = ratings.reduce((total, row) => total + row.rating, 0);
    return { average: Math.round((sum / ratings.length) * 10) / 10, count: ratings.length };
  },
};
