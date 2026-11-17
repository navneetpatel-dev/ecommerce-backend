import jwt from 'jsonwebtoken';
import { env } from '@config/env';
import { NewsletterSubscriber } from '@database/models/newsletterSubscriber.model';
import { ValidationError } from '@core/errors/ValidationError';
import { notificationsService } from '@modules/notifications/notifications.service';
import type { SubscribeNewsletterRequest } from './newsletter.dto';

const CONFIRM_PURPOSE = 'newsletter-confirm';
export const NEWSLETTER_UNSUBSCRIBE_PURPOSE = 'newsletter-unsubscribe';
const INVALID_LINK = 'This link is not valid or has expired. Subscribe again from the footer of the store.';

const clientBase = () => env.CLIENT_URL.replace(/\/$/, '');

/** Links in newsletter mail: confirming expires after a week, unsubscribing never does. */
export function signNewsletterToken(subscriberId: string, purpose: string): string {
  return jwt.sign({ sub: subscriberId, purpose }, env.JWT_SECRET, purpose === CONFIRM_PURPOSE ? { expiresIn: '7d' } : undefined);
}

export function newsletterUnsubscribeUrl(subscriberId: string): string {
  return `${clientBase()}/unsubscribe?token=${encodeURIComponent(signNewsletterToken(subscriberId, NEWSLETTER_UNSUBSCRIBE_PURPOSE))}`;
}

function readToken(token: string, purpose: string): string {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as { sub?: string; purpose?: string };
    if (decoded.purpose !== purpose || !decoded.sub) throw new Error('purpose');
    return decoded.sub;
  } catch {
    throw new ValidationError({ token: [INVALID_LINK] });
  }
}

export class NewsletterService {
  /**
   * Double opt-in: signing up records the address and emails a confirmation link; nothing is
   * sent to it until the owner confirms. Asking again before confirming re-sends the link.
   */
  async subscribe(data: SubscribeNewsletterRequest) {
    const email = data.email.trim().toLowerCase();
    const [subscriber, created] = await NewsletterSubscriber.findOrCreate({ where: { email }, defaults: { email } });
    const confirmed = Boolean(subscriber.confirmedAt) && !subscriber.unsubscribedAt;
    let confirmationSent = false;
    if (!confirmed) {
      if (subscriber.unsubscribedAt) await subscriber.update({ unsubscribedAt: null, confirmedAt: null });
      // The signup is saved either way; `confirmationSent` tells the page whether the email was
      // actually handed over, so it can say so instead of promising mail that is not coming.
      confirmationSent = (await notificationsService.enqueue({
        to: { email },
        type: 'NEWSLETTER_CONFIRM',
        referenceType: 'NewsletterSubscriber',
        referenceId: `${subscriber.id}-${Date.now()}`,
        templateData: { actionUrl: `${clientBase()}/newsletter/confirm?token=${encodeURIComponent(signNewsletterToken(subscriber.id, CONFIRM_PURPOSE))}` },
      })) != null;
    }
    return { subscribed: true as const, alreadySubscribed: !created && confirmed, confirmationSent };
  }

  async confirm(token: string) {
    const subscriber = await NewsletterSubscriber.findByPk(readToken(token, CONFIRM_PURPOSE));
    if (!subscriber) throw new ValidationError({ token: [INVALID_LINK] });
    if (!subscriber.confirmedAt) {
      await subscriber.update({ confirmedAt: new Date(), unsubscribedAt: null });
      await notificationsService.enqueue({
        to: { email: subscriber.email },
        type: 'NEWSLETTER_WELCOME',
        referenceType: 'NewsletterSubscriber',
        referenceId: `${subscriber.id}-welcome`,
        templateData: { unsubscribeUrl: newsletterUnsubscribeUrl(subscriber.id) },
      });
    }
    return { confirmed: true as const };
  }

  async unsubscribe(token: string) {
    const subscriber = await NewsletterSubscriber.findByPk(readToken(token, NEWSLETTER_UNSUBSCRIBE_PURPOSE));
    if (!subscriber) throw new ValidationError({ token: [INVALID_LINK] });
    if (!subscriber.unsubscribedAt) {
      await subscriber.update({ unsubscribedAt: new Date() });
      await notificationsService.enqueue({
        to: { email: subscriber.email },
        type: 'NEWSLETTER_UNSUBSCRIBED',
        referenceType: 'NewsletterSubscriber',
        referenceId: `${subscriber.id}-unsub-${Date.now()}`,
      });
    }
    return { unsubscribed: true as const };
  }
}

export const newsletterService = new NewsletterService();
