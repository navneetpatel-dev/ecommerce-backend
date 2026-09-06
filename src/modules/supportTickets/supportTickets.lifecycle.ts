import { SUPPORT_TICKET_STATUS, type SupportTicketStatus } from '@core/constants/statuses';

/**
 * Hours an OPEN, unassigned ticket may sit before the scheduler auto-escalates it
 * (bumps priority to URGENT and assigns it into the ticket-manager queue — see
 * `SupportTicketsService.escalateOverdueTickets`). Hardcoded for v1; promote to a
 * `settingsService` field (like `refundSlaBusinessDays`) if admins need to tune it.
 */
export const SUPPORT_TICKET_SLA_HOURS = 24;

/** Canonical ticket status transitions — imported by service + tests (single source of truth). */
export const TICKET_ALLOWED_TRANSITIONS: Record<SupportTicketStatus, SupportTicketStatus[]> = {
  [SUPPORT_TICKET_STATUS.OPEN]: [
    SUPPORT_TICKET_STATUS.IN_PROGRESS,
    SUPPORT_TICKET_STATUS.RESOLVED,
    SUPPORT_TICKET_STATUS.CLOSED,
  ],
  [SUPPORT_TICKET_STATUS.IN_PROGRESS]: [
    SUPPORT_TICKET_STATUS.RESOLVED,
    SUPPORT_TICKET_STATUS.CLOSED,
  ],
  [SUPPORT_TICKET_STATUS.RESOLVED]: [
    SUPPORT_TICKET_STATUS.REOPENED,
    SUPPORT_TICKET_STATUS.CLOSED,
  ],
  [SUPPORT_TICKET_STATUS.REOPENED]: [
    SUPPORT_TICKET_STATUS.IN_PROGRESS,
    SUPPORT_TICKET_STATUS.RESOLVED,
    SUPPORT_TICKET_STATUS.CLOSED,
  ],
  [SUPPORT_TICKET_STATUS.CLOSED]: [],
};

export function canTransitionTicketStatus(
  from: SupportTicketStatus,
  to: SupportTicketStatus,
): boolean {
  return (TICKET_ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}
