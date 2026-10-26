import { sequelize } from '@database/models';
import { ProductVariant } from '@database/models/productVariant.model';
import type { ReturnRequest } from '@database/models/returnRequest.model';
import { NotFoundError, ValidationError } from '@core/errors';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { RETURN_STATUS, RETURN_TYPE } from '@core/constants/statuses';
import { logger } from '@core/logger';
import { logAudit } from '@modules/audit/audit.service';
import { notificationsService } from '@modules/notifications/notifications.service';
import { otpService } from '@modules/auth/otp.service';
import { returnsService } from '@modules/returns/returns.service';
import { deliveryAgentsRepository as repo } from './deliveryAgents.repository';
import { deliveryAgentPayoutsService } from './deliveryAgentPayouts.service';

/**
 * The agent confirms a return pickup with the customer's OTP. The return becomes RECEIVED
 * and its refund starts (refund-on-pickup); an exchange hands over the replacement.
 */
export async function confirmReturnPickup(
  returnId: string,
  deliveryAgentId: string,
  actorId: string,
  input: { otpCode: string; itemConditionPhotoUrls?: string[]; replacementProofUrl?: string },
) {
  const result = await sequelize.transaction(async (transaction) => {
    const row = await repo.assignedPickup(returnId, deliveryAgentId, transaction);
    if (!row) throw new NotFoundError('AssignedReturnPickup');
    if (row.status !== RETURN_STATUS.PICKUP_SCHEDULED) {
      throw new ValidationError({ status: ['Return is not scheduled for pickup'] });
    }
    if (row.type === RETURN_TYPE.EXCHANGE) {
      if (!input.itemConditionPhotoUrls?.length) {
        throw new ValidationError({ itemConditionPhotoUrls: ['Condition photos are required for an exchange'] });
      }
      if (!input.replacementProofUrl) {
        throw new ValidationError({ replacementProofUrl: ['Replacement handover proof is required'] });
      }
    }
    // A wrong code returns rather than throws so the attempt is counted (committed), so
    // check it before any stock moves: it used to commit the replacement's stock loss too.
    const verification = await otpService.verifyCodeForUser(
      row.userId,
      'RETURN_PICKUP_CONFIRMATION',
      input.otpCode,
      transaction,
      row.id,
    );
    if (!verification.valid) {
      return { pickup: null, verification, finishRefund: null };
    }
    if (row.type === RETURN_TYPE.EXCHANGE) {
      const orderItem = (row as ReturnRequest & { orderItem?: { variantId: string } }).orderItem;
      if (!orderItem?.variantId) {
        throw new ValidationError({ orderItemId: ['Return has no replacement variant'] });
      }
      const variant = await ProductVariant.findByPk(orderItem.variantId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      const replacementQuantity = Number(row.returnQuantity ?? 1);
      if (!variant || Number(variant.stock) < replacementQuantity) {
        throw new ValidationError(ERROR_MESSAGES.INSUFFICIENT_STOCK);
      }
      await variant.update(
        { stock: Number(variant.stock) - replacementQuantity, updatedBy: actorId },
        { transaction },
      );
    }
    await row.update(
      {
        status: RETURN_STATUS.RECEIVED,
        receivedAt: new Date(),
        pickupOtpVerifiedAt: new Date(),
        pickupFailureReason: null,
        photoUrls: input.itemConditionPhotoUrls?.length
          ? [...row.photoUrls, ...input.itemConditionPhotoUrls]
          : row.photoUrls,
        replacementDeliveredAt: row.type === RETURN_TYPE.EXCHANGE ? new Date() : null,
        replacementProofUrl: input.replacementProofUrl ?? null,
        updatedBy: actorId,
      },
      { transaction },
    );
    await deliveryAgentPayoutsService.recordEarning(deliveryAgentId, 'PICKUP', row.id, transaction);
    // Picked up: the refund starts now, not at approval (refund-on-pickup policy).
    const finishRefund = await returnsService.startRefundOnPickup(row.id, actorId, transaction);
    await logAudit({
      actorId,
      action: 'RETURN_PICKUP_CONFIRMED',
      entityType: 'ReturnRequest',
      entityId: row.id,
      metadata: { type: row.type, otpVerified: true },
      transaction,
    });
    return { pickup: row, verification, finishRefund };
  });

  if (!result.verification.valid) {
    throw new ValidationError({ otpCode: [result.verification.message] });
  }
  const pickup = result.pickup;
  if (!pickup) throw new NotFoundError('AssignedReturnPickup');
  // The pickup stands either way: a card refund that fails is recorded FAILED and retried.
  await result.finishRefund?.().catch((err: unknown) =>
    logger.error('Return refund after pickup failed', { returnId: pickup.id, err }),
  );

  const orderId = (pickup as any).subOrder?.orderId ?? (pickup as any).subOrder?.order?.id;
  void notificationsService.sendOrderReturned(pickup.userId, pickup.id, {
    orderId,
    orderNumber: orderId ? String(orderId).slice(0, 8).toUpperCase() : '',
    status: RETURN_STATUS.RECEIVED,
  });
  return pickup;
}
