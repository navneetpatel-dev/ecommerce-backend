import { randomUUID } from 'crypto';
import type { NotificationType } from '@database/models/notificationLog.model';
import { User } from '@database/models/user.model';
import { NotFoundError } from '@core/errors/NotFoundError';
import { settingsService } from '@modules/settings/settings.service';
import { enqueueNotification } from './notificationDelivery';
import { allEmailTypes, emailMeta, type EmailAudience } from './templates/meta';
import { isMarketingNotification, renderNotificationEmail } from './templates/registry';
import { sampleEmailData } from './templates/samples';

export type EmailTemplateSummary = {
  type: NotificationType;
  audience: EmailAudience;
  group: string;
  /** The subject as it reads with sample data. */
  subject: string;
  marketing: boolean;
};

function assertKnown(type: string): NotificationType {
  if (!allEmailTypes().includes(type as NotificationType)) throw new NotFoundError('Email template');
  return type as NotificationType;
}

async function withSupport(type: NotificationType) {
  const settings = await settingsService.getPlatformSettings();
  return { supportEmail: settings.supportEmail, supportHours: settings.supportHours, ...sampleEmailData(type) };
}

/** Every email the platform can send, with its audience and a sample subject, for the admin catalogue. */
export async function listEmailTemplates(): Promise<EmailTemplateSummary[]> {
  return allEmailTypes().map((type) => ({
    type,
    audience: emailMeta(type).audience,
    group: emailMeta(type).group,
    subject: renderNotificationEmail(type, sampleEmailData(type)).subject,
    marketing: isMarketingNotification(type),
  }));
}

/** One template rendered with sample data, in the theme the admin picks. */
export async function previewEmailTemplate(rawType: string, theme: 'light' | 'dark' = 'light') {
  const type = assertKnown(rawType);
  return renderNotificationEmail(type, await withSupport(type), { theme });
}

/**
 * Sends one sample email to the admin who asked, through the real mail queue and renderer,
 * so what arrives is exactly what a recipient would get (subject marked as a test).
 */
export async function sendTestEmail(rawType: string, actorId: string): Promise<{ sentTo: string }> {
  const type = assertKnown(rawType);
  const actor = await User.findByPk(actorId, { attributes: ['id', 'email'] });
  if (!actor?.email) throw new NotFoundError('Your email address');
  await enqueueNotification({
    userId: actor.id,
    type,
    referenceType: 'EmailTest',
    referenceId: randomUUID(),
    templateData: { ...(await withSupport(type)), testEmail: true },
    // A test must arrive even when the admin has not opted in to marketing mail.
    urgency: 'transactional',
    actorId,
  });
  return { sentTo: actor.email };
}


