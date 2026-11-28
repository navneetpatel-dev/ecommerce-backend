import type { BroadcastChannel, BroadcastClassification, BroadcastPriority } from '@database/models/adminBroadcast.model';
import { enqueueNotification } from './notificationDelivery';
import { pushService } from './push.service';
import { inAppNotificationsService } from './inAppNotifications.service';
import type { EmailTemplateData } from './templates/registry';
import { interpolateBroadcastText } from './broadcastTargeting.service';
import type { ResolvedRecipient } from './broadcastTargeting.types';

const CHUNK_CONCURRENCY = 20;

function filterEmailEligible(
  recipients: ResolvedRecipient[],
  classification: BroadcastClassification,
): ResolvedRecipient[] {
  return recipients.filter(
    (r) => !r.emailSuppressed && (classification !== 'marketing' || r.emailMarketingConsent),
  );
}

/** Sends one batch of a broadcast over its channels; returns how many messages were queued. */
export async function dispatchBroadcastBatch(
  broadcastId: string | null,
  recipients: ResolvedRecipient[],
  params: {
    subject: string;
    message: string;
    ctaLabel?: string;
    ctaUrl?: string;
    classification?: BroadcastClassification;
    priority?: BroadcastPriority;
    channels: BroadcastChannel[];
    isolateMarketingQueue: boolean;
  },
  actorId?: string,
): Promise<number> {
  if (!recipients.length) return 0;
  const channels = new Set(params.channels);
  const classification = params.classification ?? 'operational';
  const refId = broadcastId ?? `test-${Date.now()}`;
  let queued = 0;

  if (channels.has('EMAIL')) {
    const emailTargets = filterEmailEligible(recipients, classification);
    const urgency =
      classification === 'marketing' || params.isolateMarketingQueue
        ? 'marketing'
        : 'transactional';
    for (let i = 0; i < emailTargets.length; i += CHUNK_CONCURRENCY) {
      const chunk = emailTargets.slice(i, i + CHUNK_CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map((user) => {
          const templateData: EmailTemplateData = {
            customerName: user.name,
            subject: interpolateBroadcastText(params.subject, user),
            message: interpolateBroadcastText(params.message, user),
            ctaLabel: params.ctaLabel,
            ctaUrl: params.ctaUrl,
            actionUrl: params.ctaUrl,
            isMarketing: classification === 'marketing',
          };
          return enqueueNotification({
            userId: user.id,
            type: 'ADMIN_BROADCAST',
            referenceType: 'AdminBroadcast',
            referenceId: refId,
            templateData,
            actorId,
            urgency,
          });
        }),
      );
      queued += results.filter((r) => r.status === 'fulfilled' && r.value != null).length;
    }
  }

  if (channels.has('PUSH')) {
    const pushTargets = recipients.filter((r) => r.hasPush);
    for (let i = 0; i < pushTargets.length; i += CHUNK_CONCURRENCY) {
      const chunk = pushTargets.slice(i, i + CHUNK_CONCURRENCY);
      await Promise.allSettled(
        chunk.map((user) =>
          pushService.sendForNotification({
            userId: user.id,
            type: 'ADMIN_BROADCAST',
            referenceType: 'AdminBroadcast',
            referenceId: refId,
            templateData: {
              customerName: user.name,
              subject: interpolateBroadcastText(params.subject, user),
              message: interpolateBroadcastText(params.message, user),
              actionUrl: params.ctaUrl,
            },
          }),
        ),
      );
      queued += chunk.length;
    }
  }

  if (channels.has('IN_APP')) {
    const inAppCount = await inAppNotificationsService.bulkCreate(
      recipients.map((user) => ({
        userId: user.id,
        broadcastId,
        title: interpolateBroadcastText(params.subject, user),
        message: interpolateBroadcastText(params.message, user),
        ctaLabel: params.ctaLabel ?? null,
        ctaUrl: params.ctaUrl ?? null,
        category: classification === 'marketing' ? 'PROMOTION' : 'ANNOUNCEMENT',
      })),
    );
    queued += inAppCount;
  }

  return queued;
}
