import { Op } from 'sequelize';
import { logger } from '@core/logger';
import { SupportTicket } from '@database/models/supportTicket.model';
import { BugReport } from '@database/models/bugReport.model';
import { SUPPORT_TICKET_STATUS } from '@core/constants/statuses';
import { settingsService } from '@modules/settings/settings.service';
import { notificationsService } from '../notifications.service';
import { findSuperAdminUserIds } from '../orderNotifications';

const DAY_MS = 24 * 60 * 60 * 1000;
const day = (date: Date) => date.toISOString().slice(0, 10);

/** A resolved ticket closed itself because nothing more was heard. */
export async function notifyTicketAutoClosed(ticketId: string): Promise<void> {
  try {
    const ticket = await SupportTicket.findByPk(ticketId);
    if (!ticket) return;
    await notificationsService.enqueue({
      userId: ticket.customerId,
      type: 'TICKET_AUTO_CLOSED',
      referenceType: 'SupportTicket',
      referenceId: ticket.id,
      templateData: { ticketId: ticket.id, ticketNumber: ticket.ticketNumber, subject: ticket.subject, portalGroup: 'customer' },
    });
  } catch (error) {
    logger.warn('Ticket auto-closed email failed', { ticketId, error: error instanceof Error ? error.message : error });
  }
}

/**
 * Resolved tickets that will close for good within a day get one last reminder that
 * they can still be reopened. Returns how many reminders were queued.
 */
export async function processReopenWindowReminders(now: Date = new Date()): Promise<number> {
  const settings = await settingsService.getPlatformSettings();
  const windowMs = settings.ticketReopenWindowDays * DAY_MS;
  // Resolved between (window - 1 day) and (window) ago: closing within the next day.
  const tickets = await SupportTicket.findAll({
    where: {
      status: SUPPORT_TICKET_STATUS.RESOLVED,
      resolvedAt: { [Op.gt]: new Date(now.getTime() - windowMs), [Op.lte]: new Date(now.getTime() - windowMs + DAY_MS) },
    },
    limit: 200,
  });
  let queued = 0;
  for (const ticket of tickets) {
    if (!ticket.resolvedAt) continue;
    try {
      const log = await notificationsService.enqueue({
        userId: ticket.customerId,
        type: 'TICKET_REOPEN_WINDOW_ENDING',
        referenceType: 'SupportTicket',
        referenceId: ticket.id,
        templateData: {
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          portalGroup: 'customer',
          expiresAt: day(new Date(ticket.resolvedAt.getTime() + windowMs)),
        },
      });
      if (log) queued += 1;
    } catch (error) {
      logger.warn('Reopen reminder failed', { ticketId: ticket.id, error: error instanceof Error ? error.message : error });
    }
  }
  return queued;
}

/** A new bug report was filed: the admin team triages it. */
export async function notifyAdminsOfNewBugReport(bugReportId: string): Promise<void> {
  try {
    const bug = await BugReport.findByPk(bugReportId);
    if (!bug) return;
    for (const adminId of await findSuperAdminUserIds()) {
      await notificationsService.enqueue({
        userId: adminId,
        type: 'ADMIN_NEW_BUG_REPORT',
        referenceType: 'BugReport',
        referenceId: bug.id,
        templateData: {
          bugReportId: bug.id,
          reportNumber: bug.reportNumber,
          title: bug.title,
          details: [
            { label: 'Reporter role', value: String(bug.reporterRole ?? '') },
            ...(bug.severity ? [{ label: 'Severity', value: String(bug.severity) }] : []),
          ],
        },
      });
    }
  } catch (error) {
    logger.warn('New bug report email failed', { bugReportId, error: error instanceof Error ? error.message : error });
  }
}
