import { logger } from '@core/logger';
import { ROLES } from '@core/constants/statuses';
import { User } from '@database/models/user.model';
import { Role } from '@database/models/role.model';
import { areQueuesReady, queues } from '@config/queue';
import { sendEmail } from '@config/mail';
import { reportEngine, type ReportActor } from '@modules/reports/engine/reportEngine';

export type ScheduledReportsDeps = {
  sendMail?: typeof sendEmail;
};

export const SCHEDULED_REPORTS_JOB = 'scheduled-weekly-reports';
const SCHEDULED_REPORTS_JOB_ID = 'scheduled-weekly-reports-monday';

const WEEKLY_REPORT_TYPES = ['reconciliation', 'gmv-sales'] as const;

async function adminRecipients(): Promise<User[]> {
  return User.findAll({
    include: [{ model: Role, as: 'role', required: true, where: { name: ROLES.SUPER_ADMIN } }],
    limit: 20,
  });
}

export async function runScheduledWeeklyReports(
  deps: ScheduledReportsDeps = {},
): Promise<number> {
  const deliver = deps.sendMail ?? sendEmail;
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  const admins = await adminRecipients();
  let sent = 0;

  for (const admin of admins) {
    if (!admin.email) continue;
    const actor: ReportActor = {
      id: admin.id,
      vendorId: admin.vendorId ?? null,
      roleName: ROLES.SUPER_ADMIN,
      permissions: [],
    };
    for (const reportType of WEEKLY_REPORT_TYPES) {
      try {
        const exported = await reportEngine.runExportDirect(
          actor,
          reportType,
          { from, to },
          'xlsx',
        );
        await deliver({
          to: admin.email,
          subject: `Weekly report: ${reportType}`,
          html: `<p>Your weekly ${reportType} report for the past 7 days is attached.</p>`,
          text: `Your weekly ${reportType} report for the past 7 days is attached.`,
          attachments: [
            {
              filename: exported.filename,
              content: exported.buffer,
              contentType: exported.contentType,
            },
          ],
        });
        sent += 1;
      } catch (err) {
        logger.warn('Scheduled report export skipped', {
          reportType,
          userId: admin.id,
          error: err instanceof Error ? err.message : err,
        });
      }
    }
  }
  return sent;
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
