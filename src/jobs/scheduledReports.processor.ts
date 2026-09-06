import { logger } from '@core/logger';
import { ROLES } from '@core/constants/statuses';
import { User } from '@database/models/user.model';
import { Role } from '@database/models/role.model';
import { areQueuesReady, queues } from '@config/queue';
import { sendEmail } from '@config/mail';
import { reportEngine, type ReportActor } from '@modules/reports/engine/reportEngine';
import { settingsService } from '@modules/settings/settings.service';

export type ScheduledReportsDeps = {
  sendMail?: typeof sendEmail;
  now?: Date;
};

export const SCHEDULED_REPORTS_JOB = 'scheduled-admin-reports';
const SCHEDULED_REPORTS_JOB_ID = 'scheduled-admin-reports-hourly';

/**
 * The BullMQ repeatable trigger fires every hour on a FIXED cron pattern — it never changes.
 * Admins configure *when* the digest actually sends (day of week + hour, via platform settings),
 * and `runScheduledWeeklyReports` checks that configured cadence against `now` on every tick,
 * only proceeding to build/send reports on the one tick per week that matches.
 *
 * This avoids the complexity (and BullMQ API churn) of re-registering the repeatable job's own
 * cron pattern every time an admin edits the cadence in settings — the trigger schedule and the
 * "should I actually run" decision are deliberately decoupled.
 */
const TRIGGER_CRON = '0 * * * *';

function cadenceMatches(now: Date, dayOfWeek: number, hourUtc: number): boolean {
  return now.getUTCDay() === dayOfWeek && now.getUTCHours() === hourUtc;
}

async function resolveRecipients(emails: string[]): Promise<User[]> {
  if (emails.length > 0) {
    return User.findAll({ where: { email: emails }, limit: 50 });
  }
  // Fallback (v1 default): explicit recipient list is empty — email every SUPER_ADMIN.
  return User.findAll({
    include: [{ model: Role, as: 'role', required: true, where: { name: ROLES.SUPER_ADMIN } }],
    limit: 20,
  });
}

export async function runScheduledWeeklyReports(
  deps: ScheduledReportsDeps = {},
): Promise<number> {
  const deliver = deps.sendMail ?? sendEmail;
  const now = deps.now ?? new Date();
  const settings = await settingsService.getPlatformSettings();

  if (!settings.scheduledReportsEnabled) return 0;
  if (!cadenceMatches(now, settings.scheduledReportsDayOfWeek, settings.scheduledReportsHourUtc)) {
    return 0;
  }

  const schedulable = new Set(reportEngine.schedulableCatalog().map((r) => r.type));
  const reportTypes = settings.scheduledReportsTypes.filter((type) => {
    if (schedulable.has(type)) return true;
    logger.warn('Scheduled report type is not schedulable, skipping', { reportType: type });
    return false;
  });
  if (reportTypes.length === 0) return 0;

  const to = now;
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  const recipients = await resolveRecipients(settings.scheduledReportsRecipients);
  let sent = 0;

  for (const recipient of recipients) {
    if (!recipient.email) continue;
    const actor: ReportActor = {
      id: recipient.id,
      vendorId: recipient.vendorId ?? null,
      roleName: ROLES.SUPER_ADMIN,
      permissions: [],
    };
    for (const reportType of reportTypes) {
      try {
        const exported = await reportEngine.runExportDirect(
          actor,
          reportType,
          { from, to },
          'xlsx',
        );
        await deliver({
          to: recipient.email,
          subject: `Scheduled report: ${reportType}`,
          html: `<p>Your scheduled ${reportType} report for the past 7 days is attached.</p>`,
          text: `Your scheduled ${reportType} report for the past 7 days is attached.`,
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
          userId: recipient.id,
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
      repeat: { pattern: TRIGGER_CRON },
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  );
  logger.info('Scheduled admin reports job registered', { trigger: TRIGGER_CRON });
}
