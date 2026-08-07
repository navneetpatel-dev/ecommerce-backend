import { Op } from 'sequelize';
import { NotificationLog } from '@database/models/notificationLog.model';
import { User } from '@database/models/user.model';
import { NOTIFICATION_STATUS } from '@core/constants/statuses';
import { logger } from '@core/logger';

type SesSnsMessage = {
  notificationType?: 'Bounce' | 'Complaint' | 'Delivery';
  mail?: { messageId?: string; destination?: string[] };
  bounce?: { bounceType?: string };
  complaint?: { complaintFeedbackType?: string };
};

/**
 * Handles SES → SNS notifications (bounce / complaint).
 * Marks matching NotificationLog rows and suppresses marketing for the recipient.
 */
export async function handleSesEvent(payload: unknown): Promise<{ processed: number }> {
  const envelope = payload as { Type?: string; Message?: string } & SesSnsMessage;

  let event: SesSnsMessage = envelope;
  if (envelope.Type === 'Notification' && typeof envelope.Message === 'string') {
    try {
      event = JSON.parse(envelope.Message) as SesSnsMessage;
    } catch {
      logger.warn('SES webhook — invalid SNS Message JSON');
      return { processed: 0 };
    }
  }

  const messageId = event.mail?.messageId;
  const destinations = event.mail?.destination ?? [];
  if (!messageId && destinations.length === 0) {
    return { processed: 0 };
  }

  const status =
    event.notificationType === 'Complaint'
      ? NOTIFICATION_STATUS.COMPLAINED
      : event.notificationType === 'Bounce'
        ? NOTIFICATION_STATUS.BOUNCED
        : null;

  if (!status) {
    return { processed: 0 };
  }

  let processed = 0;
  if (messageId) {
    const logs = await NotificationLog.findAll({
      where: { providerMessageId: messageId },
    });
    for (const log of logs) {
      await log.update({ status, error: event.notificationType ?? status });
      processed += 1;
    }
  }

  if (destinations.length) {
    await User.update(
      { emailSuppressed: true },
      {
        where: {
          email: { [Op.in]: destinations },
        },
      },
    );
  }

  logger.info('SES webhook processed', {
    type: event.notificationType,
    messageId,
    processed,
    suppressed: destinations.length,
  });

  return { processed };
}
