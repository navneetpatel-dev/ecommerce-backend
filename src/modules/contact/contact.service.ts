import { randomBytes } from 'crypto';
import { ContactMessage } from '@database/models/contactMessage.model';
import { logger } from '@core/logger';
import { settingsService } from '@modules/settings/settings.service';
import { notificationsService } from '@modules/notifications/notifications.service';
import { CONTACT_TOPIC_LABELS, type CreateContactMessageRequest } from './contact.dto';

function newReference(): string {
  return `CM-${randomBytes(3).toString('hex').toUpperCase()}`;
}

export class ContactService {
  /**
   * Stores the message, tells the sender it arrived (with a reference to quote), and
   * forwards it to the support inbox with the sender as reply-to so support can just answer.
   */
  async submit(data: CreateContactMessageRequest, userId?: string | null) {
    const reference = newReference();
    const email = data.email.toLowerCase();
    const topicLabel = CONTACT_TOPIC_LABELS[data.topic];
    const record = await ContactMessage.create({
      userId: userId ?? null,
      name: data.name,
      email,
      topic: data.topic,
      subject: data.subject,
      message: data.message,
      reference,
    });

    const settings = await settingsService.getPlatformSettings();
    const summary = [
      { label: 'Reference', value: reference, strong: true },
      { label: 'Topic', value: topicLabel },
      { label: 'Subject', value: data.subject },
    ];
    await Promise.allSettled([
      notificationsService.enqueue({
        to: { email, name: data.name },
        type: 'CONTACT_ACKNOWLEDGEMENT',
        referenceType: 'ContactMessage',
        referenceId: record.id,
        templateData: { reference, subject: data.subject, details: [...summary, { label: 'Your message', value: data.message.slice(0, 600) }], detailsTitle: 'What you sent us' },
      }),
      notificationsService.enqueue({
        to: { email: settings.supportEmail, name: 'Support team' },
        type: 'ADMIN_CONTACT_ENQUIRY',
        referenceType: 'ContactMessage',
        referenceId: `${record.id}-support`,
        templateData: {
          senderName: data.name,
          senderEmail: email,
          subject: data.subject,
          replyTo: email,
          details: [...summary, { label: 'From', value: `${data.name} <${email}>` }, { label: 'Message', value: data.message }],
          detailsTitle: 'Enquiry',
        },
      }),
    ]).then((results) => {
      for (const result of results) {
        if (result.status === 'rejected') logger.warn('Contact email failed', { reference, error: result.reason instanceof Error ? result.reason.message : result.reason });
      }
    });
    return { reference };
  }
}

export const contactService = new ContactService();
