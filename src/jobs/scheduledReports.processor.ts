import { logger } from '@core/logger';
import { ROLES } from '@core/constants/statuses';
import { User } from '@database/models/user.model';
import { Role } from '@database/models/role.model';
import { areQueuesReady, queues } from '@config/queue';
import { reportEngine, type ReportActor } from '@modules/reports/engine/reportEngine';
import { reportExportConfig } from '@modules/reports/reportExportConfig';
import { env } from '@config/env';

export const SCHEDULED_REPORTS_JOB = 'scheduled-weekly-reports';
const SCHEDULED_REPORTS_JOB_ID = 'scheduled-weekly-reports-monday';

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
        const exported = await reportEngine.runExport(
          actor,
          reportType,
          { from, to },
          'xlsx',
          { priority: reportExportConfig.scheduledExportPriority },
        );
        if (exported.async) queued += 1;
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

export async function scheduleWeeklyReportsJob(): Promise<void> {
  if (!areQueuesReady()) return;
  await queues.reportExport.add(
    SCHEDULED_REPORTS_JOB,
    {},
    {
      jobId: SCHEDULED_REPORTS_JOB_ID,
      repeat: { pattern: '0 6 * * 1' },
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  );
  logger.info('Scheduled weekly reports job registered', { cron: '0 6 * * 1' });
}
