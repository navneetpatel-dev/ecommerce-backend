import { Op, fn, col } from 'sequelize';
import { AdminBroadcast } from '@database/models/adminBroadcast.model';
import { NotificationLog } from '@database/models/notificationLog.model';
import { User } from '@database/models/user.model';

/** Past and scheduled broadcasts, newest first, each with how its emails went. */
export async function listBroadcasts(limit = 50) {
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
