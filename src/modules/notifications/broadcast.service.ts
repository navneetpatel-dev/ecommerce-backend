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
import { bulkResendNotifications } from './emailRecovery';
import { renderNotificationEmail } from './templates/registry';
import { dispatchBroadcastBatch } from './broadcastDispatch';
import { listBroadcasts } from './broadcastHistory';
import { searchCategories, searchLocations, searchTargetUsers } from './broadcastPickers';
import type { BroadcastInput, BroadcastSendResult } from './broadcast.types';
import {
  interpolateBroadcastText,
  previewBroadcastTargetsQuery,
  resolveBroadcastBatch,
  type BroadcastTargetConfig,
  type ResolvedRecipient,
} from './broadcastTargeting.service';

export type { BroadcastInput, BroadcastSendResult } from './broadcast.types';

const BATCH_SIZE = 200;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class BroadcastService {
  async previewTargets(params: {
    targetConfig: BroadcastTargetConfig;
    classification?: BroadcastClassification;
    channels?: BroadcastChannel[];
    page?: number;
    limit?: number;
  }) {
    return previewBroadcastTargetsQuery(params.targetConfig, {
      classification: params.classification,
      channels: params.channels,
      page: params.page,
      limit: params.limit,
    });
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
    const sent = await dispatchBroadcastBatch(null, [recipient], {
      ...params,
      subject: `[Test] ${params.subject}`,
      channels,
      isolateMarketingQueue: false,
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

    const preview = await this.previewTargets({ targetConfig, classification, channels, page: 1, limit: 1 });
    const scheduledDate = params.scheduledAt ? new Date(params.scheduledAt) : null;
    if (scheduledDate && scheduledDate.getTime() > Date.now() + 10_000) {
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
      targetedCount: preview.total,
      queuedCount: 0,
    });

    // Dispatch large or normal broadcasts asynchronously in keyset batches so HTTP never times out.
    setImmediate(() => {
      void this.executeBroadcastRecord(record, actorId).catch(async (err) => {
        logger.error('Background broadcast execution failed', { broadcastId: record.id, err });
        await record.update({
          status: 'FAILED',
          error: err instanceof Error ? err.message : 'Broadcast failed',
        });
      });
    });

    return {
      broadcastId: record.id,
      status: 'PROCESSING',
      targeted: preview.total,
      queued: 0,
    };
  }

  async executeBroadcastRecord(record: AdminBroadcast, actorId?: string | null): Promise<BroadcastSendResult> {
    const targetConfig = (record.targetConfig ?? {}) as BroadcastTargetConfig;
    const isolateMarketingQueue = record.targetedCount > 50 && record.priority !== 'high';
    let afterId: string | undefined;
    let totalTargeted = 0;
    let totalQueued = 0;

    for (;;) {
      const batch = await resolveBroadcastBatch(targetConfig, { afterId, limit: BATCH_SIZE });
      if (batch.length === 0) break;

      totalTargeted += batch.length;
      const queued = await dispatchBroadcastBatch(
        record.id,
        batch,
        {
          subject: record.subject,
          message: record.message,
          ctaLabel: record.ctaLabel ?? undefined,
          ctaUrl: record.ctaUrl ?? undefined,
          classification: record.classification,
          priority: record.priority,
          channels: record.channels,
          isolateMarketingQueue,
        },
        actorId ?? record.actorId ?? undefined,
      );
      totalQueued += queued;
      afterId = batch[batch.length - 1]!.id;

      await record.update({ targetedCount: Math.max(record.targetedCount, totalTargeted), queuedCount: totalQueued });
      if (batch.length < BATCH_SIZE) break;
      await sleep(50);
    }

    await record.update({
      status: 'SENT',
      sentAt: new Date(),
      targetedCount: totalTargeted,
      queuedCount: totalQueued,
    });

    return {
      broadcastId: record.id,
      status: 'SENT',
      targeted: totalTargeted,
      queued: totalQueued,
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

  listBroadcasts = listBroadcasts;
  searchTargetUsers = searchTargetUsers;
  searchCategories = searchCategories;
  searchLocations = searchLocations;

  async retryFailedForBroadcast(id: string, actorId: string) {
    const record = await AdminBroadcast.findByPk(id, { attributes: ['id'] });
    if (!record) throw new AppError('Broadcast not found', 404, ERROR_CODES.NOT_FOUND);
    return bulkResendNotifications(actorId, { referenceId: id, includeStuckPending: true });
  }

  async sendTestForBroadcast(id: string, actorId: string): Promise<{ sentTo: string; queued: number }> {
    const record = await AdminBroadcast.findByPk(id);
    if (!record) throw new AppError('Broadcast not found', 404, ERROR_CODES.NOT_FOUND);
    return this.sendTestToActor(actorId, {
      subject: record.subject,
      message: record.message,
      ctaLabel: record.ctaLabel ?? undefined,
      ctaUrl: record.ctaUrl ?? undefined,
      classification: record.classification,
      priority: record.priority,
      channels: record.channels,
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

}

export const broadcastService = new BroadcastService();
