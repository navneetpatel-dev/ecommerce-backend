import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { ContactMessage } from '@database/models/contactMessage.model';
import { notificationsService } from '@modules/notifications/notifications.service';
import { settingsService } from '@modules/settings/settings.service';
import { CreateContactMessageSchema } from '../contact.dto';
import { contactService } from '../contact.service';

type Row = Record<string, any>;

describe('contactService', () => {
  afterEach(() => mock.restoreAll());

  it('stores the message, acknowledges the sender and forwards it to support with the sender as reply-to', async () => {
    const stored: Row[] = [];
    mock.method(ContactMessage, 'create', async (fields: Row) => {
      stored.push(fields);
      return { id: 'cm-1', ...fields } as never;
    });
    mock.method(settingsService, 'getPlatformSettings', async () => ({ supportEmail: 'help@shop.test' }) as never);
    const sent: Row[] = [];
    mock.method(notificationsService, 'enqueue', async (params: Row) => {
      sent.push(params);
      return null as never;
    });

    const { reference } = await contactService.submit(
      { name: 'Karan', email: 'Karan@Example.com', topic: 'ORDER', subject: 'Where is it', message: 'My order has not moved since Monday.' },
      'user-1',
    );

    assert.match(reference, /^CM-[0-9A-F]{6}$/);
    assert.equal(stored[0]!.userId, 'user-1');
    assert.equal(stored[0]!.email, 'karan@example.com');
    const ack = sent.find((mail) => mail.type === 'CONTACT_ACKNOWLEDGEMENT')!;
    const enquiry = sent.find((mail) => mail.type === 'ADMIN_CONTACT_ENQUIRY')!;
    assert.equal(ack.to.email, 'karan@example.com');
    assert.equal(ack.templateData.reference, reference);
    assert.equal(enquiry.to.email, 'help@shop.test');
    assert.equal(enquiry.templateData.replyTo, 'karan@example.com');
  });

  it('validates the form (length limits, topic, strict fields)', () => {
    const base = { name: 'Karan', email: 'k@x.com', topic: 'ORDER', subject: 'Hello there', message: 'A message long enough.' };
    assert.equal(CreateContactMessageSchema.safeParse(base).success, true);
    assert.equal(CreateContactMessageSchema.safeParse({ ...base, message: 'short' }).success, false);
    assert.equal(CreateContactMessageSchema.safeParse({ ...base, topic: 'NOPE' }).success, false);
    assert.equal(CreateContactMessageSchema.safeParse({ ...base, extra: 1 }).success, false);
  });
});
