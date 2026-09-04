import webpush from 'web-push';
import { env } from '@config/env';
import { logger } from '@core/logger';
import { NOTIFICATION_STATUS } from '@core/constants/statuses';
import { NotificationLog, type NotificationType } from '@database/models/notificationLog.model';
import { PushSubscription } from '@database/models/pushSubscription.model';
import { renderNotificationEmail, type EmailTemplateData } from './templates/registry';

const PUSH_NOTIFICATION_TYPES = new Set<NotificationType>([
  'ORDER_CONFIRMATION',
  'PAYMENT_RECEIPT',
  'PAYMENT_FAILED',
  'SUBORDER_SHIPPED',
  'SUBORDER_DELIVERED',
  'ORDER_CANCELLED',
  'ORDER_RETURNED',
  'REFUND_INITIATED',
  'REFUND_PROCESSED',
  'DELIVERY_ASSIGNED',
  'PICKUP_ASSIGNED',
  'DELIVERY_OTP',
  'RETURN_PICKUP_OTP',
  'RTO_HANDOVER_OTP',
  'DELIVERY_ATTEMPT_FAILED',
]);

function isConfigured(): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

if (isConfigured()) {
  webpush.setVapidDetails(env.VAPID_SUBJECT!, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
}

export class PushService {
  publicKey(): string | null {
    return env.VAPID_PUBLIC_KEY ?? null;
  }

  async subscribe(
    userId: string,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    userAgent?: string,
  ) {
    const [row] = await PushSubscription.upsert({
      userId,
      endpoint: subscription.endpoint,
      p256dhKey: subscription.keys.p256dh,
      authKey: subscription.keys.auth,
      userAgent: userAgent?.slice(0, 512) ?? null,
    });
    return row;
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await PushSubscription.destroy({ where: { userId, endpoint } });
  }

  async sendForNotification(params: {
    userId: string;
    type: NotificationType;
    referenceType: string;
    referenceId: string;
    templateData: EmailTemplateData;
  }): Promise<void> {
    if (!isConfigured() || !PUSH_NOTIFICATION_TYPES.has(params.type)) return;
    const subscriptions = await PushSubscription.findAll({ where: { userId: params.userId } });
    if (!subscriptions.length) return;

    const rendered = renderNotificationEmail(params.type, params.templateData);
    const body = rendered.text.split('\n\n')[2] ?? 'Open the app to view this update.';
    const payload = JSON.stringify({
      title: rendered.subject,
      body,
      url: String(params.templateData.actionUrl ?? env.CLIENT_URL),
      tag: `${params.type}:${params.referenceId}`,
    });
    const log = await NotificationLog.create({
      userId: params.userId,
      type: params.type,
      referenceType: params.referenceType,
      referenceId: `${params.referenceId}:push`,
      channel: 'PUSH',
      status: NOTIFICATION_STATUS.PENDING,
      providerMessageId: null,
      error: null,
      sentAt: null,
      createdBy: params.userId,
      updatedBy: null,
      deletedBy: null,
    });

    const results = await Promise.allSettled(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dhKey, auth: subscription.authKey },
            },
            payload,
          );
          return true;
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) await subscription.destroy();
          throw error;
        }
      }),
    );
    const sentCount = results.filter((result) => result.status === 'fulfilled').length;
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    await log.update({
      status: sentCount > 0 ? NOTIFICATION_STATUS.SENT : NOTIFICATION_STATUS.FAILED,
      sentAt: sentCount > 0 ? new Date() : null,
      error: sentCount > 0 ? null : failed?.reason instanceof Error ? failed.reason.message : 'Push delivery failed',
    });
    if (failed) {
      logger.warn('One or more browser push deliveries failed', {
        userId: params.userId,
        type: params.type,
        failedCount: results.length - sentCount,
      });
    }
  }
}

export const pushService = new PushService();
