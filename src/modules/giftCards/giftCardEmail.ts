import { env } from '@config/env';
import { GiftCard } from '@database/models/giftCard.model';
import { User } from '@database/models/user.model';
import { logger } from '@core/logger';
import { notificationsService } from '@modules/notifications/notifications.service';
import { inr } from '@modules/notifications/templates/blocks';

const redeemUrl = (code: string) => `${env.CLIENT_URL.replace(/\/$/, '')}/gift-cards/redeem/${code}`;

/**
 * Emails a purchased gift card: the card itself to its recipient (who may not have an
 * account), and a confirmation to the buyer. Both go through the normal mail queue, so
 * they are logged, retried and styled like every other email. A resend uses a fresh
 * reference, otherwise the duplicate guard would swallow it. Resolves true once the card
 * is queued for its recipient.
 */
export async function sendGiftCardPurchasedEmail(giftCard: GiftCard, options: { resend?: boolean } = {}): Promise<boolean> {
  try {
    const purchaser = await User.findByPk(giftCard.purchaserId, { attributes: ['name', 'email'] });
    const suffix = options.resend ? `-${Date.now()}` : '';
    const amount = Number(giftCard.amount);
    const received = await notificationsService.enqueue({
      to: { email: giftCard.recipientEmail, name: giftCard.recipientName },
      type: 'GIFT_CARD_RECEIVED',
      referenceType: 'GiftCard',
      referenceId: `${giftCard.id}${suffix}`,
      templateData: {
        customerName: giftCard.recipientName,
        name: giftCard.recipientName,
        purchaserName: purchaser?.name || purchaser?.email || 'Someone',
        amount,
        message: giftCard.message ?? '',
        codeBox: { code: giftCard.code, caption: `Worth ${inr(amount).replace('.00', '')} · valid until ${giftCard.expiresAt.toISOString().slice(0, 10)}` },
        actionUrl: redeemUrl(giftCard.code),
      },
    });
    if (!options.resend) {
      await notificationsService.enqueue({
        userId: giftCard.purchaserId,
        type: 'GIFT_CARD_PURCHASED',
        referenceType: 'GiftCard',
        referenceId: giftCard.id,
        templateData: {
          amount,
          recipientName: giftCard.recipientName || giftCard.recipientEmail,
          details: [
            { label: 'Sent to', value: giftCard.recipientEmail },
            ...(giftCard.message ? [{ label: 'Your message', value: giftCard.message }] : []),
            { label: 'Valid until', value: giftCard.expiresAt.toISOString().slice(0, 10) },
          ],
        },
      });
    }
    return received != null;
  } catch (error) {
    logger.error('Failed to queue gift card email', { giftCardId: giftCard.id, error: error instanceof Error ? error.message : error });
    return false;
  }
}

/** The recipient redeemed the card: let the buyer know their gift landed. */
export async function notifyGiftCardRedeemed(giftCardId: string): Promise<void> {
  try {
    const card = await GiftCard.findByPk(giftCardId);
    if (!card) return;
    const redeemer = card.redeemedByUserId ? await User.findByPk(card.redeemedByUserId, { attributes: ['name'] }) : null;
    await notificationsService.enqueue({
      userId: card.purchaserId,
      type: 'GIFT_CARD_REDEEMED',
      referenceType: 'GiftCardRedeemed',
      referenceId: card.id,
      templateData: { amount: Number(card.amount), recipientName: card.recipientName || redeemer?.name || card.recipientEmail },
    });
  } catch (error) {
    logger.warn('Gift card redeemed email failed', { giftCardId, error: error instanceof Error ? error.message : error });
  }
}
