import { Op } from 'sequelize';
import { logger } from '@core/logger';
import { AppError } from '@core/errors';
import { ERROR_CODES } from '@core/constants/errors';
import {
  AdminBroadcast,
  type BroadcastChannel,
  type BroadcastClassification,
  type BroadcastPriority,
} from '@database/models/adminBroadcast.model';
import { Role } from '@database/models/role.model';
import { User } from '@database/models/user.model';
import { enqueueNotification } from './notificationDelivery';
import { pushService } from './push.service';
import { renderNotificationEmail, type EmailTemplateData } from './templates/registry';
import {
  interpolateBroadcastText,
  resolveBroadcastRecipients,
  type BroadcastTargetConfig,
  type ResolvedRecipient,
} from './broadcastTargeting.service';
import { inAppNotificationsService } from './inAppNotifications.service';

export interface BroadcastSendResult {
  broadcastId: string;
  status: string;
  scheduledAt?: Date | null;
  targeted: number;
  queued: number;
}

export interface BroadcastInput extends BroadcastTargetConfig {
  subject: string;
  message: string;
  ctaLabel?: string;
  ctaUrl?: string;
  classification?: BroadcastClassification;
  priority?: BroadcastPriority;
  channels?: BroadcastChannel[];
  scheduledAt?: string | null;
}

function filterEmailEligible(
  recipients: ResolvedRecipient[],
  classification: BroadcastClassification,
): ResolvedRecipient[] {
  return recipients.filter(
    (r) => !r.emailSuppressed && (classification !== 'marketing' || r.emailMarketingConsent),
  );
}

export class BroadcastService {
  async previewTargets(params: {
    targetConfig: BroadcastTargetConfig;
    classification?: BroadcastClassification;
    channels?: BroadcastChannel[];
  }) {
    const classification = params.classification ?? 'operational';
    const recipients = await resolveBroadcastRecipients(params.targetConfig, { classification });
    const emailEligible = filterEmailEligible(recipients, classification).length;
    const pushEligible = recipients.filter((r) => r.hasPush).length;
    return {
      total: recipients.length,
      emailEligible,
      pushEligible,
      inAppEligible: recipients.length,
      sampleRecipients: recipients.slice(0, 25).map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
        businessName: r.businessName,
      })),
    };
  }

  renderPreview(params: {
    subject: string;
    message: string;
    ctaLabel?: string;
    ctaUrl?: string;
    classification?: BroadcastClassification;
    theme?: 'light' | 'dark';
  }) {
    const sampleRecipient: ResolvedRecipient = {
      id: 'preview-user',
      email: 'alex.sharma@example.com',
      name: 'Alex Sharma',
      role: 'CUSTOMER',
      businessName: 'Apex Essentials',
      city: 'Bengaluru',
      emailVerified: true,
      emailMarketingConsent: true,
      emailSuppressed: false,
      hasPush: true,
    };
    const subject = interpolateBroadcastText(params.subject, sampleRecipient);
    const message = interpolateBroadcastText(params.message, sampleRecipient);
    const rendered = renderNotificationEmail(
      'ADMIN_BROADCAST',
      {
        customerName: sampleRecipient.name,
        subject,
        message,
        ctaLabel: params.ctaLabel,
        ctaUrl: params.ctaUrl,
        actionUrl: params.ctaUrl,
        isMarketing: params.classification === 'marketing',
      },
      { theme: params.theme ?? 'light' },
    );
    return { subject: rendered.subject, html: rendered.html, text: rendered.text };
  }

  async sendTestToActor(actorId: string, params: BroadcastInput) {
    const channels = params.channels?.length ? params.channels : (['EMAIL'] as BroadcastChannel[]);
    const user = await User.findByPk(actorId, {
      include: [{ model: Role, as: 'role', attributes: ['name'] }],
    });
    const recipient: ResolvedRecipient = {
      id: actorId,
      email: user?.email ?? '',
      name: user?.name ?? 'Admin',
      role: user?.role?.name ?? 'SUPER_ADMIN',
      businessName: 'Marketplace Admin',
      city: 'Bengaluru',
      emailVerified: true,
      emailMarketingConsent: true,
      emailSuppressed: false,
      hasPush: true,
    };
    const sent = await this.dispatchToRecipients(null, [recipient], {
      ...params,
      subject: `[Test] ${params.subject}`,
      channels,
    });
    return { sentTo: user?.email ?? actorId, queued: sent };
  }

  async sendOrSchedule(actorId: string, params: BroadcastInput): Promise<BroadcastSendResult> {
    const channels: BroadcastChannel[] = params.channels?.length ? params.channels : ['EMAIL'];
    const classification: BroadcastClassification = params.classification ?? 'operational';
    const priority: BroadcastPriority = params.priority ?? 'standard';
    const targetConfig: BroadcastTargetConfig = {
      mode: params.mode,
      allUsers: params.allUsers,
      role: params.role,
      roles: params.roles,
      userIds: params.userIds,
      emails: params.emails,
      userSegment: params.userSegment,
      vendorSegment: params.vendorSegment,
      excludeUserIds: params.excludeUserIds,
      excludeRoles: params.excludeRoles,
    };

    const scheduledDate = params.scheduledAt ? new Date(params.scheduledAt) : null;
    if (scheduledDate && scheduledDate.getTime() > Date.now() + 10_000) {
      const preview = await this.previewTargets({ targetConfig, classification, channels });
      const record = await AdminBroadcast.create({
        actorId,
        subject: params.subject,
        message: params.message,
        ctaLabel: params.ctaLabel ?? null,
        ctaUrl: params.ctaUrl ?? null,
        classification,
        priority,
        channels,
        targetConfig: targetConfig as Record<string, unknown>,
        status: 'SCHEDULED',
        scheduledAt: scheduledDate,
        targetedCount: preview.total,
        queuedCount: 0,
      });
      return {
        broadcastId: record.id,
        status: record.status,
        scheduledAt: record.scheduledAt,
        targeted: preview.total,
        queued: 0,
      };
    }

    const record = await AdminBroadcast.create({
      actorId,
      subject: params.subject,
      message: params.message,
      ctaLabel: params.ctaLabel ?? null,
      ctaUrl: params.ctaUrl ?? null,
      classification,
      priority,
      channels,
      targetConfig: targetConfig as Record<string, unknown>,
      status: 'PROCESSING',
    });

    return this.executeBroadcastRecord(record, actorId);
  }

  async executeBroadcastRecord(record: AdminBroadcast, actorId?: string | null): Promise<BroadcastSendResult> {
    const targetConfig = (record.targetConfig ?? {}) as BroadcastTargetConfig;
    const recipients = await resolveBroadcastRecipients(targetConfig, {
      classification: record.classification,
      channels: record.channels,
    });
    const queued = await this.dispatchToRecipients(record.id, recipients, {
      subject: record.subject,
      message: record.message,
      ctaLabel: record.ctaLabel ?? undefined,
      ctaUrl: record.ctaUrl ?? undefined,
      classification: record.classification,
      priority: record.priority,
      channels: record.channels,
    }, actorId ?? record.actorId ?? undefined);

    await record.update({
      status: 'SENT',
      sentAt: new Date(),
      targetedCount: recipients.length,
      queuedCount: queued,
    });

    return {
      broadcastId: record.id,
      status: 'SENT' as const,
      targeted: recipients.length,
      queued,
    };
  }

  async processDueScheduledBroadcasts(): Promise<number> {
    const due = await AdminBroadcast.findAll({
      where: { status: 'SCHEDULED', scheduledAt: { [Op.lte]: new Date() } },
      limit: 10,
    });
    let processed = 0;
    for (const record of due) {
      try {
        await record.update({ status: 'PROCESSING' });
        await this.executeBroadcastRecord(record);
        processed += 1;
      } catch (err) {
        await record.update({
          status: 'FAILED',
          error: err instanceof Error ? err.message : 'Scheduled broadcast failed',
        });
        logger.warn('Scheduled broadcast failed', { broadcastId: record.id, err });
      }
    }
    return processed;
  }

  async listBroadcasts(limit = 50) {
    return AdminBroadcast.findAll({
      order: [['createdAt', 'DESC']],
      limit: Math.min(Math.max(limit, 1), 100),
      include: [{ model: User, as: 'actor', attributes: ['id', 'name', 'email'] }],
    });
  }

  async cancelScheduled(id: string) {
    const record = await AdminBroadcast.findByPk(id);
    if (!record) throw new AppError('Broadcast not found', 404, ERROR_CODES.NOT_FOUND);
    if (record.status !== 'SCHEDULED') {
      throw new AppError('Only scheduled broadcasts can be cancelled', 400, ERROR_CODES.VALIDATION_ERROR);
    }
    await record.update({ status: 'CANCELLED' });
    return record;
  }

  async searchTargetUsers(
    q: string,
  ): Promise<Array<{ id: string; name: string; email: string; role: string }>> {
    const trimmed = q.trim();
    const where: Record<string, unknown> = { status: 'ACTIVE' };
    if (trimmed) {
      where[Op.or as unknown as string] = [
        { name: { [Op.iLike]: `%${trimmed}%` } },
        { email: { [Op.iLike]: `%${trimmed}%` } },
      ];
    }
    const users = await User.findAll({
      where,
      attributes: ['id', 'name', 'email'],
      include: [{ model: Role, as: 'role', attributes: ['name'] }],
      limit: 20,
      order: [['createdAt', 'DESC']],
    });
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role?.name ?? 'CUSTOMER',
    }));
  }

  private async dispatchToRecipients(
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
      const emailResults = await Promise.allSettled(
        emailTargets.map((user) => {
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
            urgency: classification === 'marketing' ? 'marketing' : 'transactional',
          });
        }),
      );
      queued += emailResults.filter((r) => r.status === 'fulfilled' && r.value != null).length;
    }

    if (channels.has('PUSH')) {
      const pushTargets = recipients.filter((r) => r.hasPush);
      await Promise.allSettled(
        pushTargets.map((user) =>
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
      queued += pushTargets.length;
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
}

export const broadcastService = new BroadcastService();
