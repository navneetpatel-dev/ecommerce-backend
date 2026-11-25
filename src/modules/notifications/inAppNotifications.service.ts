import { Op } from 'sequelize';
import { InAppNotification } from '@database/models/inAppNotification.model';

export interface InAppBroadcastItem {
  userId: string;
  broadcastId: string | null;
  title: string;
  message: string;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  category?: string;
}

const CHUNK_SIZE = 500;

export class InAppNotificationsService {
  async bulkCreate(items: InAppBroadcastItem[]): Promise<number> {
    if (!items.length) return 0;
    let created = 0;
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE).map((item) => ({
        userId: item.userId,
        broadcastId: item.broadcastId ?? null,
        title: item.title.slice(0, 200),
        message: item.message,
        ctaLabel: item.ctaLabel ?? null,
        ctaUrl: item.ctaUrl ?? null,
        category: item.category ?? 'BROADCAST',
        isRead: false,
      }));
      await InAppNotification.bulkCreate(chunk);
      created += chunk.length;
    }
    return created;
  }

  async listForUser(userId: string, opts: { limit?: number; unreadOnly?: boolean } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
    const where: Record<string, unknown> = { userId };
    if (opts.unreadOnly) where.isRead = false;

    const [items, unreadCount] = await Promise.all([
      InAppNotification.findAll({
        where,
        order: [['createdAt', 'DESC']],
        limit,
      }),
      InAppNotification.count({ where: { userId, isRead: false } }),
    ]);

    return { items, unreadCount };
  }

  async markRead(userId: string, id: string): Promise<void> {
    await InAppNotification.update(
      { isRead: true, readAt: new Date() },
      { where: { id, userId, isRead: false } },
    );
  }

  async markAllRead(userId: string): Promise<void> {
    await InAppNotification.update(
      { isRead: true, readAt: new Date() },
      { where: { userId, isRead: false, createdAt: { [Op.lte]: new Date() } } },
    );
  }
}

export const inAppNotificationsService = new InAppNotificationsService();
