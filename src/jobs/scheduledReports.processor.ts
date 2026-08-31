import { logger } from '@core/logger';
import { ROLES } from '@core/constants/statuses';
import { User } from '@database/models/user.model';
import { Role } from '@database/models/role.model';
import { reportEngine, type ReportActor } from '@modules/reports/engine/reportEngine';
import { notificationsService } from '@modules/notifications/notifications.service';
import { env } from '@config/env';

const WEEKLY_REPORT_TYPES = ['reconciliation', 'gmv-sales'] as const;

async function adminRecipients(): Promise<User[]> {
  return User.findAll({
    include: [{ model: Role, as: 'role', required: true, where: { name: ROLES.SUPER_ADMIN } }],
    limit: 20,
  });
}

export async function runScheduledWeeklyReports(): Promise<number> {
  if (env.NODE_ENV === 'test') return 0;
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  const admins = await adminRecipients();
  let queued = 0;

  for (const admin of admins) {
    const actor: ReportActor = {
      id: admin.id,
      vendorId: admin.vendorId ?? null,
      roleName: ROLES.SUPER_ADMIN,
      permissions: [],
    };
    for (const reportType of WEEKLY_REPORT_TYPES) {
      try {
        const exported = await reportEngine.runExport(actor, reportType, { from, to }, 'xlsx');
        if (exported.async) {
          void notificationsService.sendReportExportReady(admin.id, exported.exportId, {
            reportType,
            rowCount: exported.rowCount,
            actionUrl: `${env.CLIENT_URL.replace(/\/$/, '')}/admin/reports?exportId=${exported.exportId}`,
          });
          queued += 1;
        }
      } catch (err) {
        logger.warn('Scheduled report export skipped', {
          reportType,
          userId: admin.id,
          error: err instanceof Error ? err.message : err,
        });
      }
    }
  }
  return queued;
}

let timer: NodeJS.Timeout | null = null;

/** Weekly Monday 06:00 UTC — queue reconciliation + GMV exports for super admins. */
export function startScheduledReportsScheduler(): void {
  if (timer) return;
  const dayMs = 24 * 60 * 60 * 1000;
  const tick = () => {
    const now = new Date();
    if (now.getUTCDay() === 1 && now.getUTCHours() === 6) {
      void runScheduledWeeklyReports().catch((err) =>
        logger.error('Scheduled reports failed', {
          error: err instanceof Error ? err.message : err,
        }),
      );
    }
  };
  timer = setInterval(tick, dayMs);
  logger.info('Scheduled reports scheduler started');
}

export function stopScheduledReportsScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
