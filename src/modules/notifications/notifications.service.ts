import { NotificationLog } from '@database/models/notificationLog.model';
import { NOTIFICATION_STATUS } from '@core/constants/statuses';

export class NotificationsService {
  async listLogs() {
    return NotificationLog.findAll({ limit: 100, order: [['createdAt', 'DESC']] });
  }

  async createTest(actorId: string, body: Record<string, unknown>) {
    const log = await NotificationLog.create({
      ...body,
      userId: body.userId ?? actorId,
      type: body.type ?? 'WELCOME',
      referenceType: body.referenceType ?? 'USER',
      referenceId: body.referenceId ?? actorId,
      channel: body.channel ?? 'EMAIL',
      status: NOTIFICATION_STATUS.PENDING,
      createdBy: actorId,
    } as any);

    return {
      ...log.get({ plain: true }),
      message: 'Queued for delivery (configure email worker to send)',
    };
  }
}

export const notificationsService = new NotificationsService();
