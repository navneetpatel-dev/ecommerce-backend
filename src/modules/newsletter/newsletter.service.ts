import { NewsletterSubscriber } from '@database/models/newsletterSubscriber.model';
import type { SubscribeNewsletterRequest } from './newsletter.dto';

export class NewsletterService {
  async subscribe(data: SubscribeNewsletterRequest) {
    const email = data.email.trim().toLowerCase();
    const [, created] = await NewsletterSubscriber.findOrCreate({
      where: { email },
      defaults: { email },
    });
    return { subscribed: true as const, alreadySubscribed: !created };
  }
}

export const newsletterService = new NewsletterService();
