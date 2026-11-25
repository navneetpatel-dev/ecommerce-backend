import { Op, fn, col } from 'sequelize';
import { logger } from '@core/logger';
import { AppError } from '@core/errors';
import { ERROR_CODES } from '@core/constants/errors';
import { CATEGORY_STATUS } from '@core/constants/statuses';
import {
  AdminBroadcast,
  type BroadcastChannel,
  type BroadcastClassification,
  type BroadcastPriority,
} from '@database/models/adminBroadcast.model';
import { Address } from '@database/models/address.model';
import { Category } from '@database/models/category.model';
import { NotificationLog } from '@database/models/notificationLog.model';
import { Role } from '@database/models/role.model';
import { User } from '@database/models/user.model';
import { Vendor } from '@database/models/vendor.model';
import { bulkResendNotifications } from './emailRecovery';
import { enqueueNotification } from './notificationDelivery';
import { pushService } from './push.service';
import { renderNotificationEmail, type EmailTemplateData } from './templates/registry';
import {
  interpolateBroadcastText,
  previewBroadcastTargetsQuery,
  resolveBroadcastBatch,
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

const BATCH_SIZE = 200;
const CHUNK_CONCURRENCY = 20;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    const sent = await this.dispatchBatch(null, [recipient], {
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

    while (true) {
      const batch = await resolveBroadcastBatch(targetConfig, { afterId, limit: BATCH_SIZE });
      if (batch.length === 0) break;

      totalTargeted += batch.length;
      const queued = await this.dispatchBatch(
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

  async listBroadcasts(limit = 50) {
    const broadcasts = await AdminBroadcast.findAll({
      order: [['createdAt', 'DESC']],
      limit: Math.min(Math.max(limit, 1), 100),
      include: [{ model: User, as: 'actor', attributes: ['id', 'name', 'email'] }],
    });
    const ids = broadcasts.map((b) => b.id);
    if (!ids.length) return [];

    const statRows = (await NotificationLog.findAll({
      where: { referenceType: 'AdminBroadcast', referenceId: { [Op.in]: ids } },
      attributes: ['referenceId', 'status', [fn('COUNT', col('id')), 'count']],
      group: ['referenceId', 'status'],
      raw: true,
    })) as unknown as Array<{ referenceId: string; status: string; count: string | number }>;

    const statsMap = new Map<
      string,
      { sentCount: number; failedCount: number; bouncedCount: number; pendingCount: number }
    >();
    for (const row of statRows) {
      const cur = statsMap.get(row.referenceId) ?? {
        sentCount: 0,
        failedCount: 0,
        bouncedCount: 0,
        pendingCount: 0,
      };
      const n = Number(row.count) || 0;
      if (row.status === 'SENT') cur.sentCount += n;
      else if (row.status === 'FAILED') cur.failedCount += n;
      else if (row.status === 'BOUNCED' || row.status === 'COMPLAINED') cur.bouncedCount += n;
      else if (row.status === 'PENDING') cur.pendingCount += n;
      statsMap.set(row.referenceId, cur);
    }

    return broadcasts.map((b) => ({
      ...b.get({ plain: true }),
      stats: statsMap.get(b.id) ?? {
        sentCount: 0,
        failedCount: 0,
        bouncedCount: 0,
        pendingCount: 0,
      },
    }));
  }

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

  async searchTargetUsers(
    q: string,
    page = 1,
    limit = 20,
  ): Promise<{
    items: Array<{ id: string; name: string; email: string; role: string }>;
    total: number;
    page: number;
    hasMore: boolean;
  }> {
    const safePage = Math.max(page, 1);
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const trimmed = q.trim();
    const where: Record<string | symbol, unknown> = { status: 'ACTIVE' };
    if (trimmed) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${trimmed}%` } },
        { email: { [Op.iLike]: `%${trimmed}%` } },
      ];
    }
    const { count, rows } = await User.findAndCountAll({
      where: where as Record<string, unknown>,
      attributes: ['id', 'name', 'email'],
      include: [{ model: Role, as: 'role', attributes: ['name'] }],
      limit: safeLimit,
      offset: (safePage - 1) * safeLimit,
      order: [['createdAt', 'DESC'], ['id', 'ASC']],
    });
    return {
      items: rows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role?.name ?? 'CUSTOMER',
      })),
      total: count,
      page: safePage,
      hasMore: safePage * safeLimit < count,
    };
  }

  async searchCategories(
    q: string,
    page = 1,
    limit = 20,
  ): Promise<{
    items: Array<{ id: string; name: string; slug: string }>;
    total: number;
    page: number;
    hasMore: boolean;
  }> {
    const safePage = Math.max(page, 1);
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const trimmed = q.trim();
    const where: Record<string, unknown> = { status: CATEGORY_STATUS.ACTIVE };
    if (trimmed) where.name = { [Op.iLike]: `%${trimmed}%` };
    const { count, rows } = await Category.findAndCountAll({
      where,
      attributes: ['id', 'name', 'slug'],
      limit: safeLimit,
      offset: (safePage - 1) * safeLimit,
      order: [['name', 'ASC']],
    });
    return {
      items: rows.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
      total: count,
      page: safePage,
      hasMore: safePage * safeLimit < count,
    };
  }

  async searchLocations(field: 'state' | 'city', q: string, page = 1, limit = 20) {
    const safePage = Math.max(page, 1);
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const trimmed = q.trim();
    const locWhere = trimmed
      ? { [field]: { [Op.and]: [{ [Op.ne]: null }, { [Op.iLike]: `%${trimmed}%` }] } }
      : { [field]: { [Op.ne]: null } };

    const [addrRows, vendorRows] = await Promise.all([
      Address.findAll({ where: locWhere, attributes: [[fn('DISTINCT', col(field)), field]], raw: true }),
      Vendor.findAll({ where: locWhere, attributes: [[fn('DISTINCT', col(field)), field]], raw: true }),
    ]);

    const merged = [
      ...new Set(
        [...addrRows, ...vendorRows]
          .map((r) => String((r as unknown as Record<string, unknown>)[field] ?? '').trim())
          .filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b));

    const start = (safePage - 1) * safeLimit;
    return {
      items: merged.slice(start, start + safeLimit),
      total: merged.length,
      page: safePage,
      hasMore: start + safeLimit < merged.length,
    };
  }

  private async dispatchBatch(
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
}

export const broadcastService = new BroadcastService();
