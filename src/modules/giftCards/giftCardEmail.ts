import { env } from '@config/env';
import { sendEmail } from '@config/mail';
import { escapeHtml, renderEmailLayout } from '@modules/notifications/templates/layout';
import { GiftCard } from '@database/models/giftCard.model';
import { User } from '@database/models/user.model';
import { logger } from '@core/logger';

function formatInr(amount: number): string {
  return amount.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });
}

/**
 * Sent directly via the raw mail transport (not the NotificationLog/enqueue
 * pipeline) because the recipient is an arbitrary email address, not
 * necessarily a registered User — enqueue() requires a User row.
 */
export async function sendGiftCardPurchasedEmail(giftCard: GiftCard): Promise<void> {
  const purchaser = await User.findByPk(giftCard.purchaserId, { attributes: ['name', 'email'] });
  const purchaserLabel = escapeHtml(purchaser?.name || purchaser?.email || 'Someone');
  const amount = formatInr(Number(giftCard.amount));
  const base = env.CLIENT_URL.replace(/\/$/, '');
  const redeemUrl = `${base}/gift-cards/redeem/${giftCard.code}`;

  const greeting = giftCard.recipientName ? `Hi ${escapeHtml(giftCard.recipientName)},` : 'Hi,';
  const messageLine = giftCard.message
    ? ` with a message: &ldquo;${escapeHtml(giftCard.message)}&rdquo;`
    : '';
  const subject = `You've received a ${amount} gift card`;
  const bodyHtml = `<p>${greeting}</p><p>${purchaserLabel} sent you a gift card worth ${amount}${messageLine}.</p><p>Redeem it below to add the balance straight to your wallet.</p>`;

  const rendered = renderEmailLayout({
    preview: subject,
    title: subject,
    bodyHtml,
    ctaLabel: 'Redeem gift card',
    ctaUrl: redeemUrl,
  });

  try {
    await sendEmail({
      to: giftCard.recipientEmail,
      subject,
      html: rendered.html,
      text: rendered.text,
    });
  } catch (error) {
    logger.error('Failed to send gift card email', {
      giftCardId: giftCard.id,
      error: error instanceof Error ? error.message : error,
    });
  }
}
